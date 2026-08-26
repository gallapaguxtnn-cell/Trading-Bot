# PLANO_FIX_TPS_DESATIVANDO — Por que os Take Profits somem

Cinco defeitos encadeados. Os três primeiros fazem TP sumir; o quarto esconde; o quinto é a origem do resíduo que gera os trades duplicados do `PLANO_FIX_TRADES_DUPLICADOS.md`.

---

## DEFEITO 1 — O checkbox de TP na UI é decorativo

`backend/src/strategies/strategies.service.ts` — `findAllPublic()` (linha ~40) e `findOnePublic()` (linha ~78) usam `select` explícito que **não inclui** `enableTakeProfit1/2/3`.

`frontend/app/strategies/page.tsx`:
- linha ~75: `enableTakeProfit1: strategy.enableTakeProfit1 ?? true` — como o backend nunca devolve o campo, é sempre `undefined` → **o checkbox aparece SEMPRE MARCADO**, qualquer que seja o valor no banco.
- linhas 122-152 (`handleSubmit`): o payload monta 30 campos e **não inclui nenhum `enableTakeProfitN`** → salvar **nunca** grava o flag.

Consequência: desmarcar um TP não faz nada, e se o banco tiver `false` em algum registro, o TP fica desativado de forma **permanente e invisível** — não há como reativar pela interface. `webhook.service.ts:2784` filtra por `tp.enabled`, então esse `false` invisível apaga o TP silenciosamente.

## DEFEITO 2 — Heurística errada decide quantos TPs criar

`webhook.service.ts` linha ~2787:
```ts
const maxPossibleTPs = Math.floor(quantityForTPs / minQty);
```
Isso mede quantas ordens de tamanho **mínimo** cabem na posição — não tem relação com a viabilidade de TPs de 33%/33%/34%. Com base nesse número o código degrada silenciosamente:

| Ramo | O que faz | Problema |
|---|---|---|
| `>= 3` | usa os TPs configurados | ok |
| `=== 2` | **2 TPs em 50/50** | descarta `takeProfitQuantityN` configurado |
| `=== 1` | **1 TP a 100% no percentual MAIS ALTO** | a posição deixa de realizar no TP1/TP2 — muda completamente o comportamento |
| `0` | `tpConfigs = []` | **nenhum TP criado** |

Nos ramos de 2 e 1 TP os objetos são reconstruídos **sem a propriedade `enabled`** e com `qtyPercent` sobrescrito, ou seja, a configuração do usuário é jogada fora sem aviso na UI.

A verificação correta é **por TP individual**: cada fatia precisa passar em `qtyStep`, `minQty` e `minNotional`.

## DEFEITO 3 — Nenhuma verificação de nocional mínimo

Não existe checagem de `minNotional` / `minOrderValue` em nenhum ponto da criação de TP. A Bybit exige **5 USDT por ordem** em futuros USDT; a Binance tem regra equivalente. Um TP de 33% numa posição pequena fica abaixo do piso e é **rejeitado pela corretora** — que é exatamente o TP "desativando".

`getSymbolRules()` (linha ~171) só devolve `qtyStep`, `priceTick` e `minQty`. O nocional mínimo nem é lido da corretora.

## DEFEITO 4 — Falha de TP é engolida

`webhook.service.ts` linhas 2894-2896:
```ts
} catch (tpError: any) {
  this.logger.warn(`[TP${tp.id}] Failed to create, skipping: ${tpError.message}`);
}
```
Cada TP que falha vira um `warn` e é pulado. Se 2 de 3 falharem, o trade segue com 1 TP: sem retry, sem registro no banco de qual TP faltou, sem nada visível na UI. O bloco de 2908-2922 só grita se **todos** falharem **e** não houver SL.

## DEFEITO 5 — O resíduo do arredondamento (origem dos trades duplicados)

`normalizeQuantity()` (linha ~192) faz `floor` no step:
```ts
let rounded = dValue.div(dStep).floor().mul(dStep);
```
SUIUSDT tem `qtyStep = 1`. Com 1790 SUI e 33/33/34:

| TP | Calculado | Após floor |
|---|---|---|
| TP1 | 590,7 | **590** |
| TP2 | 590,7 | **590** |
| TP3 | 608,6 | **608** |
| **Soma** | 1790 | **1788** |

**Sobram 2 SUI.** A posição nunca zera pelos TPs. Esse resíduo é precisamente o que faz o trade ser fechado localmente enquanto a corretora ainda tem posição — que o `position-sync` então importa como "posição órfã" e vira o trade duplicado com PnL próprio. **Os dois problemas têm a mesma raiz.**

Além disso, se `rounded` chega a zero, `normalizeQuantity` devolve `'0'` e a ordem é enviada com quantidade zero → rejeitada → cai no catch do Defeito 4.

---

## REGRAS

1. Sem comentários em código. `npm run build` + testes verdes por fase.
2. Nunca criar ordem que exceda a posição (`reduceOnly` protege, mas a soma das fatias deve bater exatamente com a quantidade).
3. Nenhuma mudança nas fórmulas de preço de TP/SL.
4. Se um TP for inviável, isso precisa ficar **visível** — nunca degradar em silêncio.

---

## FASE 1 — DESTRAVAR O `enableTakeProfit` NA UI

1. `strategies.service.ts`: adicionar `'enableTakeProfit1'`, `'enableTakeProfit2'`, `'enableTakeProfit3'` ao `select` de `findAllPublic()` e `findOnePublic()`.
2. `frontend/app/strategies/page.tsx` → `handleSubmit`: incluir os três campos no `payload`.
3. Quando o checkbox estiver desmarcado, enviar também `takeProfitPercentageN: null` — assim o estado fica coerente nos dois campos e o filtro do webhook funciona por qualquer um dos dois.
4. Verificar se o `UpdateStrategyDto` (se existir `ValidationPipe` com `whitelist`) declara os três campos como `@IsOptional() @IsBoolean()`; sem isso o `whitelist` os remove silenciosamente.
5. Teste e2e/integração: salvar com TP2 desmarcado → `GET` devolve `enableTakeProfit2: false` → recarregar o form mantém desmarcado.

## FASE 2 — VIABILIDADE POR TP, NÃO HEURÍSTICA GLOBAL

Substituir todo o bloco `maxPossibleTPs` (linhas ~2787-2819) por uma função pura testável, `planTakeProfits()`, em novo arquivo `webhook/tp-planner.util.ts`:

**Entrada:** `quantity`, lista de TPs habilitados (`percent`, `qtyPercent`), `qtyStep`, `minQty`, `minNotional`, preço de referência de cada TP.

**Regras:**
1. Calcular a fatia de cada TP e normalizar com `floor` no `qtyStep`.
2. **A última fatia viável recebe todo o resto** (`quantity − soma das anteriores`), eliminando o resíduo do Defeito 5.
3. Descartar TPs cuja fatia normalizada seja `< minQty` **ou** cujo nocional (`fatia × preço do TP`) seja `< minNotional`; redistribuir a quantidade descartada proporcionalmente entre os TPs viáveis restantes.
4. Se nenhum TP for viável, devolver lista vazia **com motivo explícito** (`'BELOW_MIN_NOTIONAL'` / `'BELOW_MIN_QTY'`).
5. **Nunca** trocar o percentual-alvo de um TP nem inventar 50/50 — se só couber um TP, mantém o alvo do **primeiro** habilitado (realizar cedo é o comportamento conservador), não o mais alto.
6. Garantir invariante: `soma das fatias === quantity` exatamente.

O retorno deve incluir, por TP, o motivo caso tenha sido descartado, para uso nas Fases 3 e 4.

## FASE 3 — LER O NOCIONAL MÍNIMO DA CORRETORA

1. Estender `getSymbolRules()` para devolver também `minNotional`:
   - Binance: filtro `MIN_NOTIONAL` do `exchangeInfo`.
   - Bybit: `lotSizeFilter.minNotionalValue` de `instruments-info` (fallback `5` se ausente).
2. Manter o cache que já existe para as regras de símbolo.
3. Fallback conservador em caso de falha na consulta: `minNotional = 5` + `logger.warn`. Nunca deixar `undefined` chegar ao planner.

## FASE 4 — FALHA DE TP VISÍVEL

1. No `catch` de criação de TP: além do log, acumular em `failedTps: Array<{ id, reason }>`.
2. Persistir no trade um campo aditivo nullable `tpWarnings: string | null` com o resumo (ex.: `TP2:BELOW_MIN_NOTIONAL;TP3:REJECTED_BY_EXCHANGE`).
3. Retry de **uma** tentativa por TP falho com backoff curto (500ms) — muitos erros são transitórios de sincronismo de posição, principalmente na Bybit logo após a entrada.
4. `TradeCard` / timeline no frontend: badge de aviso quando `tpWarnings` estiver preenchido, listando quais TPs não entraram e por quê.
5. Elevar para `logger.error` (não `warn`) quando **qualquer** TP planejado falhar — hoje só grita se todos falharem.

## FASE 5 — AUDITOR

`auditor.service.ts`: nova issue `MISSING_TP_ORDERS` (WARNING) quando um trade `OPEN` tiver menos ordens de TP vivas na corretora do que a estratégia tem TPs habilitados. Isso pega o problema em produção sem depender de o usuário perceber no card.

## FASE 6 — TESTES E ACEITE

1. Testes unitários de `planTakeProfits()` (função pura, sem mocks de rede):
   - 1790 SUI, step 1, 33/33/34 → fatias **590 / 590 / 610**, soma exatamente 1790, **resíduo zero**.
   - Posição pequena onde TP1 fica abaixo de `minNotional` → TP1 descartado com motivo, quantidade redistribuída, soma preserva o total.
   - Nenhum TP viável → lista vazia com motivo, sem exceção.
   - TP com `enabled: false` nunca entra no plano.
   - Invariante `soma === quantity` em teste com múltiplos steps (0.001, 0.01, 1, 10).
2. Testes de integração: TP rejeitado pela corretora → retry → persiste `tpWarnings` → trade continua com os TPs que deram certo.
3. `npm run build` + suíte verde. Diff sem nenhuma alteração nas fórmulas de preço.
4. Aceite prático:
   - [ ] Desmarcar TP3, salvar, recarregar → continua desmarcado; próximo trade cria só 2 TPs.
   - [ ] Trade SUI de 1790: soma das quantidades dos TPs = 1790, sem sobra.
   - [ ] Posição pequena: TPs inviáveis aparecem como aviso no card, não somem em silêncio.
   - [ ] Após um ciclo completo de TPs, a posição zera na corretora e **não** surge trade importado.
   - [ ] Auditor sem `MISSING_TP_ORDERS` nos trades novos.

---

## ORDEM DE EXECUÇÃO RECOMENDADA

Este plano **antes** do `PLANO_FIX_TRADES_DUPLICADOS.md`: a Fase 2 elimina o resíduo na origem, o que reduz muito a incidência de posição órfã. O outro plano continua necessário como rede de segurança e para limpar o histórico.

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_FIX_TPS_DESATIVANDO.md na raiz e execute as FASES 1 a 6, uma por commit.

CONTEXTO CONFIRMADO (cinco defeitos encadeados):
1. strategies.service.ts: o select de findAllPublic/findOnePublic NÃO inclui
   enableTakeProfit1/2/3, e o handleSubmit do frontend não envia esses campos —
   o checkbox de TP na UI é puramente decorativo e um false no banco é invisível
   e impossível de reverter pela interface.
2. webhook.service.ts ~2787: maxPossibleTPs = Math.floor(quantity / minQty) é uma
   heurística errada que degrada em silêncio para 2 TPs 50/50, 1 TP a 100% no alvo
   MAIS ALTO, ou zero TPs, descartando as quantidades configuradas.
3. Não existe verificação de minNotional (Bybit exige ~5 USDT por ordem) — TPs
   pequenos são rejeitados pela corretora.
4. O catch de criação de TP só loga warn e pula: sem retry, sem persistência, sem
   nada visível na UI.
5. normalizeQuantity faz floor no qtyStep e a soma das fatias fica MENOR que a
   posição (1790 SUI com 33/33/34 e step 1 → 590+590+608 = 1788, sobram 2 SUI).
   Esse resíduo é a origem da "posição órfã" que vira trade duplicado.

REGRAS CRÍTICAS: a última fatia viável recebe o resto exato (invariante: soma das
fatias === quantity); NUNCA trocar o percentual-alvo de um TP nem inventar 50/50;
se só couber um TP, manter o alvo do PRIMEIRO habilitado, não o mais alto; TP
inviável precisa ficar visível (motivo persistido + badge), nunca sumir em
silêncio; nenhuma mudança nas fórmulas de preço de TP/SL.

A lógica de planejamento deve virar uma função pura testável em
webhook/tp-planner.util.ts, com testes sem mock de rede.

Sem comentários em código. npm run build + testes verdes por fase.
Liste mudanças por arquivo e o que cada teste cobre.
```
