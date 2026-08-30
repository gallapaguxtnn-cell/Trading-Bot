# PLANO_FIX_ARREDONDAMENTO_GLOBAL — A mesma classe de defeito ainda viva no Stop Loss

## VERIFICAÇÃO DAS CORREÇÕES ANTERIORES: APROVADAS

`npm run build` limpo. **31 suites, 203 testes, todos passando** (as 5 suites que não rodavam voltaram).

Testei o planner com as quantidades reais que quebravam antes:

| Cenário | Quantidade | Fatias | Soma | Múltiplas do step | Excede? |
|---|---|---|---|---|---|
| SUI fracionário | 1789,9801435772113 | **590 / 590 / 609** | 1789 | ✓ | não |
| SUI 60 (do print) | 59,9125364431 | 19 / 19 / 21 | 59 | ✓ | não |
| step 0.001 | 0,0287654321 | 0.009 / 0.009 / 0.01 | 0.028 | ✓ | não |
| step 0.01 | 3,14159265 | 1.03 / 1.03 / 1.08 | 3.14 | ✓ | não |
| step 10 | 12345,6789 | 4070 / 4070 / 4200 | 12340 | ✓ | não |

O `609.9801435772113` que a Bybit rejeitava agora sai como **609**. Corrigido de verdade.

Confirmado também no código:
- `minNotional: Number(rules.minNotional)` nos **3** call sites (o hardcoded `5` sumiu)
- `quantityForTPs` usa a quantidade **realmente executada** (`actualEntryQty`), com log quando diverge da bruta
- Fallback a mercado só após `TP_MISSING_RETRY_LIMIT` tentativas, gravando `TAKE_PROFIT_FALLBACK_MARKET`
- `resumeLimitProtection` com `needsStopLoss` / `needsTakeProfit` independentes, validando as ordens contra a corretora
- `resolveProtectionPrice` sem a amarra `Exchange.BINANCE` — vale para as duas corretoras
- `x-site-id` implementado no `getHeaders` da Bybit
- Buffer sem expiração por tempo (só sinal contrário / pausa / cancelamento na corretora)

---

## O PROBLEMA QUE CONTINUA: arredondamento fixo fora do webhook

A raiz do problema dos TPs era **usar casas decimais fixas em vez das regras do símbolo**. Essa correção foi aplicada no `webhook.service.ts` e no `take-profit.service.closePosition()` — mas **não** nos demais serviços. Eles seguem com `toFixed()` literal:

| Arquivo | Linha | Código | O que quebra |
|---|---|---|---|
| `stop-loss.service.ts` | 247 | `triggerPrice', stopPrice.toFixed(2)` | **preço do SL** |
| `stop-loss.service.ts` | 239 | `remainingQty.toFixed(3)` | quantidade do SL |
| `stop-loss.service.ts` | 538, 551 | `quantity.toFixed(3)` | fechamento a mercado |
| `take-profit.service.ts` | 681 | `triggerPrice', stopPrice.toFixed(2)` | **preço do SL** |
| `take-profit.service.ts` | 673 | `quantity.toFixed(3)` | quantidade do SL |
| `position-sync.service.ts` | 1101 | `quantity', tradeQuantity.toFixed(2)` | quantidade do SL |

### Impacto real por faixa de preço

**`stopPrice.toFixed(2)` — o mais grave, porque é o Stop Loss:**

| Ativo | Tick real | SL calculado | Enviado | Consequência |
|---|---|---|---|---|
| SUIUSDT (~0,75) | 0.0001 | 0,7697 | **0,77** | stop desloca ~0,04% |
| XRPUSDT (~0,50) | 0.0001 | 0,5102 | **0,51** | idem |
| PEPE / SHIB / BONK | 0.00000001 | 0,00000912 | **0,00** | **ordem rejeitada — posição sem stop** |
| BTCUSDT (~60.000) | 0.10 | 58.800,37 | 58.800,37 | ok por acaso |

**`quantity.toFixed(2)` no position-sync (linha 1101):** para BTC com step 0.001, uma posição de **0,005 BTC** vira `"0.01"` — **o dobro da posição**. Com `reduceOnly` a corretora corta, mas a ordem pode ser rejeitada; 0,004 viraria `"0.00"` → rejeitada, **sem stop**.

**`quantity.toFixed(3)` em ativos com step inteiro:** SUI (step 1) vira `"60.000"`; a Bybit tolera, a Binance com step 1 pode rejeitar por precisão.

### Por que isso importa agora mais do que antes

A **Fase 2** do plano anterior passou a acionar `resumeLimitProtection` e a recriação de proteção com muito mais frequência — justamente para fechar a janela dos 45 minutos. Esses caminhos de recriação são os que ainda usam `toFixed()`. **A correção anterior aumentou o tráfego pela parte que continua defeituosa.**

### Causa estrutural

`normalizeQuantity()` e `roundTick()` são **métodos privados** do `webhook.service.ts`. Nenhum outro serviço consegue reaproveitá-los, então cada um improvisou com `toFixed()`. Enquanto isso não virar utilitário compartilhado, o defeito volta a cada arquivo novo.

---

## REGRAS

1. Sem comentários em código. `npm run build` + testes verdes por fase.
2. Toda quantidade e todo preço enviados a qualquer corretora passam pelo utilitário compartilhado. Sem exceção.
3. Nunca **aumentar** quantidade no arredondamento (sempre `floor`) — arredondar para cima pode exceder a posição.
4. Se as regras do símbolo não puderem ser lidas, **abortar a ordem com erro explícito** em vez de improvisar casas decimais.

## FASE 1 — UTILITÁRIO COMPARTILHADO

Criar `src/common/exchange-precision.util.ts` com funções puras:
- `normalizeQuantity(value, qtyStep, minQty): string` — `floor` ao step, via `Decimal`
- `roundPriceToTick(value, priceTick): string` — arredonda ao tick, via `Decimal`
- `isMultipleOfStep(value, step): boolean` — usando `Decimal.mod`, nunca `%` de float

Mover a implementação que já existe (e está correta) no `webhook.service.ts` para cá e passar o webhook a consumir o utilitário — sem mudar comportamento.

## FASE 2 — REGRAS DO SÍMBOLO ACESSÍVEIS A TODOS

`getSymbolRules()` hoje é privado do `webhook.service.ts`. Extrair para um `SymbolRulesService` injetável (mantendo o cache de 1h e os fallbacks) e injetar em `stop-loss.service`, `take-profit.service` e `position-sync.service`.

## FASE 3 — SUBSTITUIR TODOS OS `toFixed()`

Trocar, um a um, os 6 pontos da tabela acima pelas funções da Fase 1, buscando as regras via Fase 2. Nenhuma mudança de lógica além do arredondamento.

Ao final, garantir por busca que **não resta nenhum `toFixed(` em parâmetro enviado à corretora** — só em logs e formatação de tela.

## FASE 4 — TRAVA CONTRA REGRESSÃO

1. Teste que varre o código-fonte e falha se encontrar `toFixed(` dentro de `params.append(`, `qty:` ou `price:` — impede que o padrão volte.
2. Testes de precisão por faixa: ativo de preço alto (BTC), médio (SUI), e micro (PEPE, tick `0.00000001`) — preço e quantidade têm de sair válidos nos três.
3. Teste do caso `0.005 BTC` → quantidade **não** pode virar `0.01`.

## FASE 5 — ACEITE

- [ ] Nenhum `toFixed(` em parâmetro de ordem (busca no diff).
- [ ] SL recriado em SUI mantém 4 casas (`0.7697`, não `0.77`).
- [ ] Teste com ativo de tick `0.00000001` gera preço válido, não `0.00`.
- [ ] `npm run build` + 203+ testes verdes.

---

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_FIX_ARREDONDAMENTO_GLOBAL.md na raiz e execute as FASES 1 a 5, uma por commit.

CONTEXTO CONFIRMADO: a raiz do problema dos TPs era usar casas decimais fixas em
vez das regras do símbolo. Isso foi corrigido no webhook.service.ts e no
take-profit.service.closePosition(), mas continua em 6 pontos:

  stop-loss.service.ts:247      triggerPrice', stopPrice.toFixed(2)     <- SL
  stop-loss.service.ts:239      remainingQty.toFixed(3)
  stop-loss.service.ts:538,551  quantity.toFixed(3)
  take-profit.service.ts:681    triggerPrice', stopPrice.toFixed(2)     <- SL
  take-profit.service.ts:673    quantity.toFixed(3)
  position-sync.service.ts:1101 quantity', tradeQuantity.toFixed(2)

IMPACTO: em SUI (tick 0.0001) um SL de 0.7697 vira 0.77; em ativos de preço micro
(PEPE/SHIB, tick 0.00000001) o preço vira 0.00 e a ordem é REJEITADA — posição sem
stop. No position-sync, 0.005 BTC com toFixed(2) vira "0.01" (o dobro da posição).
Isso ficou mais perigoso depois da FASE 2 do plano anterior, que passou a acionar a
recriação de proteção com muito mais frequência — exatamente pelos caminhos acima.

CAUSA ESTRUTURAL: normalizeQuantity() e roundTick() são métodos PRIVADOS do
webhook.service.ts, então os outros serviços improvisaram com toFixed(). Extrair
para src/common/exchange-precision.util.ts (funções puras com Decimal) e getSymbolRules
para um SymbolRulesService injetável, mantendo o cache de 1h.

REGRAS CRÍTICAS: quantidade sempre com floor (nunca arredondar para cima — excede a
posição); comparação de múltiplo com Decimal.mod, nunca % de float; se as regras do
símbolo não puderem ser lidas, ABORTAR a ordem com erro explícito em vez de
improvisar casas decimais; nenhuma mudança de lógica além do arredondamento.

Incluir na FASE 4 um teste que varre o código e falha se voltar a existir toFixed(
dentro de params.append(, qty: ou price:.

Sem comentários em código. npm run build + testes verdes por fase.
Liste mudanças por arquivo e o que cada teste cobre.
```
