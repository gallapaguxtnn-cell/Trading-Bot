# PLANO_FIX_TP_PLANNER_STEP — Correções na aplicação do PLANO_FIX_TPS_DESATIVANDO

Revisão dos commits `6218351`..`e7ab8a5`. As 6 fases foram aplicadas, mas a Fase 2 tem dois defeitos que **anulam o objetivo do plano** e podem piorar o sintoma original na Bybit.

## O QUE FICOU CORRETO

| Fase | Situação |
|---|---|
| 1 — `enableTakeProfit` na UI | ✓ `select` corrigido nos dois métodos, payload envia os 3 campos, `takeProfitPercentageN: null` quando desmarcado. `ValidationPipe` não usa `whitelist`, então nada é removido. |
| 2 — heurística global | ✓ `maxPossibleTPs`, o ramo 50/50 e o "alvo mais alto" foram removidos. `planTakeProfits()` é função pura, usada nos 3 caminhos (1285, 1557, 2733). |
| 3 — `minNotional` | ✓ `getSymbolRules()` lê `MIN_NOTIONAL` (Binance) e `minNotionalValue` (Bybit), fallback `'5'`. **Ver DEFEITO 3.** |
| 4 — falha visível | ✓ `tpWarnings` na entity, `withOneRetry`, `logger.error`, badge no `TradeCard`. |
| 5 — auditor | ✓ `MISSING_TP_ORDERS` implementado. |
| 6 — testes | ✓ 10 testes do planner, 160 testes passando. **Ver DEFEITO 5.** |

---

## DEFEITO 1 (CRÍTICO) — A última fatia não é múltipla do `qtyStep`

`tp-planner.util.ts` linhas 99-106:
```ts
const sumExceptLast = planned.slice(0, -1).reduce(...);
planned[lastIndex] = { ...planned[lastIndex], quantity: dQuantity.minus(sumExceptLast).toFixed() };
```
A última fatia recebe o resto **sem realinhar ao `qtyStep`**.

**Comprovado em execução** com a quantidade real do caso SUI:
```
quantity bruta: 1789.9801435772113
fatias: [ '590', '590', '609.9801435772113' ]
TP1 = 590                 múltiplo do step? true
TP2 = 590                 múltiplo do step? true
TP3 = 609.9801435772113   múltiplo do step? FALSE
```

Consequência por corretora:
- **Bybit** (`webhook.service.ts:2812`, `qty: tp.quantity` — vai direto, sem `normalizeQuantity`): a ordem é enviada com `609.9801435772113` e a corretora **rejeita por erro de precisão**. O TP3 falha *sempre*. Isso **agrava** o sintoma original ("TPs desativando").
- **Binance** (`createBinanceTakeProfitOrder` → `normalizeQuantity` interno): faz `floor` → 609 → **o resíduo volta**, anulando a Fase 2.

O plano pedia a invariante `soma === quantity`. A implementação cumpriu essa literalmente e quebrou a mais importante: **toda fatia deve ser múltipla do `qtyStep`**.

## DEFEITO 2 (CRÍTICO) — O planner usa a quantidade bruta, não a executada

`webhook.service.ts:2308`: `quantity = targetNotional / effectivePrice` — divisão em ponto flutuante, **nunca** múltipla do step (1171.9 / 0.65470 = 1789,9801…).

Mas a **ordem de entrada** é enviada por `normalizeQuantity(quantity, ...)` (linhas 3031/3099), que faz `floor` → a posição real na corretora é **1789**.

O planner então distribui sobre **1789,98**, e a soma das fatias fica **maior que a posição real**. Com `reduceOnly` a corretora corta ou rejeita — mais TP falhando.

**A quantidade que alimenta o planner tem de ser a mesma que foi executada.**

## DEFEITO 3 (MÉDIO) — `minNotional` hardcoded no caminho principal

`webhook.service.ts:2743`:
```ts
minNotional: 5,
```
As linhas 1295 e 1567 usam corretamente `Number(rules.minNotional)`. Só o caminho principal de criação de proteção ficou com o literal — a Fase 3 foi aplicada pela metade justamente onde mais importa.

## DEFEITO 4 (MENOR) — Sem migração para as colunas novas

`tpWarnings` (trade.entity.ts:84) e `excludeFromStats` não têm migração. O projeto roda com `synchronize: true` (`app.module.ts:41,56`), então as colunas são criadas sozinhas — mas o próprio comentário no código diz "Set to false in production if using migrations". Vale gerar as migrações antes que alguém desligue o synchronize.

## DEFEITO 5 (MENOR) — Cobertura de teste enganosa

1. Todos os testes de `tp-planner.util.spec.ts` usam quantidades **já redondas** (1790). Por isso os 10 passam e o Defeito 1 escapou. Falta o caso que importa: quantidade fracionária.
2. `strategies.service.spec.ts` tem 2 erros de tipo em `tsc --noEmit` (linhas 52 e 62). Não quebram `npm run build` (o `nest build` exclui specs), mas sujam a checagem de tipos.
3. **Pré-existente, não é regressão**: 5 suites não rodam (`app.controller`, `exchange.service`, `strategies.controller`, `webhook.controller`, **`webhook.service`**) por `https-proxy-agent` ser ESM e faltar `transformIgnorePatterns`. É grave que justamente `webhook.service.spec.ts` esteja fora da execução — é o arquivo mais crítico do projeto.

---

## CORREÇÕES

### FASE A — Normalizar a quantidade total dentro do planner

Em `planTakeProfits()`, antes de distribuir:
1. `const baseQuantity = floorToStep(dQuantity, dStep)` — passa a ser a base de **todo** o cálculo, inclusive do resto da última fatia.
2. A última fatia vira `baseQuantity.minus(sumExceptLast)`, que agora é garantidamente múltipla do step (diferença de dois múltiplos).
3. Invariante nova a testar: **toda fatia é múltipla do `qtyStep`** *e* `soma === floorToStep(quantity)`.
4. Se `baseQuantity` for zero, devolver `planned: []` com todos descartados por `BELOW_MIN_QTY`.
5. Revalidar a última fatia contra `minQty` e `minNotional` após receber o resto — hoje ela não passa por nenhuma checagem.

### FASE B — Alimentar o planner com a quantidade realmente executada

1. Nos 3 call sites (1285, 1557, 2733), passar a quantidade **normalizada/preenchida**, não a bruta:
   - caminho LIMIT/buffer: usar a quantidade preenchida real (`cumExecQty` / `executedQty`), que os monitores de fill já obtêm;
   - caminho MARKET: usar `normalizeQuantity(quantity, rules.qtyStep, rules.minQty)`, o mesmo valor enviado na entrada.
2. Se a quantidade real da posição estiver disponível na corretora naquele ponto, ela tem precedência sobre o valor calculado.
3. Log quando a quantidade bruta divergir da normalizada, para ficar rastreável.

### FASE C — Usar o `minNotional` real no caminho principal

`webhook.service.ts:2743`: trocar `minNotional: 5` por `Number(rules.minNotional)`, igual às linhas 1295 e 1567.

### FASE D — Migrações

Gerar migração para `trade.tpWarnings` e `trade.excludeFromStats`, seguindo o padrão dos arquivos em `src/migrations/`.

### FASE E — Testes que teriam pego isto

1. `tp-planner.util.spec.ts`:
   - **quantidade fracionária**: `1171.9 / 0.65470` com step `'1'` → fatias `590 / 590 / 609`, todas inteiras, soma `1789` (= `floor` da bruta).
   - invariante paramétrica: para steps `0.001`, `0.01`, `1`, `10` e quantidades fracionárias, **toda** fatia é múltiplo exato do step (usar `Decimal.mod(step).isZero()`, nunca `%` de float).
   - última fatia abaixo de `minNotional` → descartada com motivo, não emitida.
2. Corrigir os 2 erros de tipo em `strategies.service.spec.ts`.
3. Adicionar `transformIgnorePatterns` no Jest para transformar `https-proxy-agent` (e demais deps ESM), de modo que as 5 suites voltem a rodar — em especial `webhook.service.spec.ts`.
4. `npm run build` + suíte verde, agora com as 27 suites executando.

---

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_FIX_TP_PLANNER_STEP.md na raiz e execute as FASES A a E, uma por commit.

CONTEXTO: a revisão dos commits 6218351..e7ab8a5 encontrou dois defeitos críticos
na Fase 2 do plano anterior, comprovados em execução:

1. planTakeProfits() atribui à última fatia o resto (dQuantity.minus(sumExceptLast))
   SEM realinhar ao qtyStep. Com a quantidade real 1789.9801435772113 e step '1',
   as fatias saem ['590','590','609.9801435772113'] — a terceira NÃO é múltipla do
   step. Na Bybit (webhook.service.ts:2812, qty: tp.quantity vai direto) a ordem é
   rejeitada por precisão e o TP3 falha SEMPRE; na Binance o normalizeQuantity
   interno faz floor e reintroduz o resíduo, anulando a Fase 2.
2. O planner recebe a quantidade BRUTA (quantity = targetNotional / effectivePrice,
   linha 2308), enquanto a ordem de entrada é enviada com normalizeQuantity (floor).
   A posição real é 1789 mas os TPs somam 1789.98 — excedem a posição.

Também: minNotional está hardcoded como 5 na linha 2743 (as linhas 1295 e 1567 já
usam Number(rules.minNotional) corretamente).

REGRAS CRÍTICAS: a invariante correta é DUPLA — toda fatia múltipla do qtyStep E
soma === floorToStep(quantity); a quantidade que alimenta o planner deve ser a
mesma efetivamente executada; a última fatia também precisa ser validada contra
minQty e minNotional; comparações de múltiplo devem usar Decimal.mod, nunca % de
float; não alterar as fórmulas de preço de TP/SL.

Os testes atuais passam porque todos usam quantidade redonda (1790) — adicionar os
casos fracionários da FASE E antes de corrigir, para ver falharem primeiro.

Sem comentários em código. npm run build + testes verdes por fase.
Liste mudanças por arquivo e o que cada teste cobre.
```
