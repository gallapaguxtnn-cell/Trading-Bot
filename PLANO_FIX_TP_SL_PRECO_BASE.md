# PLANO_FIX_TP_SL_PRECO_BASE — Bybit calcula TP/SL sobre o preço do SINAL, não sobre o fill real

## CAUSA RAIZ (confirmada no código e nos números)

`backend/src/webhook/webhook.service.ts` linha ~2621:

```ts
const priceForProtectionOrders = (exchange === Exchange.BINANCE && !isLimitOrder && actualEntryPrice && !isAveragingTrade)
  ? actualEntryPrice  // First entry MARKET: use real execution price
  : entryPrice;       // Averaging or LIMIT: use signal price
```

A condição exige `exchange === Exchange.BINANCE`. **Na Bybit, qualquer ordem a MERCADO cai no `else` e usa o preço do SINAL** como base para calcular TP e SL — não o preço realmente executado.

Esse mesmo valor alimenta os dois:
- linha ~2649 → `calculateStopLossPrice(side, priceForProtectionOrders, ...)`
- linha ~2801 → `calculateTakeProfitPrice(side, priceForProtectionOrders, tp.percent)`

### Prova com o caso real (SUIUSDT LONG, TIPO MARKET, Bybit)

| Dado | Valor |
|---|---|
| TP1 executado | `0.65760` |
| Preço do sinal implícito (`0.65760 / 1.003`) | `0.65563` |
| Entrada real registrada | `0.65470` |
| TP efetivo sobre a entrada real | `(0.65760 − 0.65470) / 0.65470` = **0,443%** |
| ENTRY→EXIT no card | `(0.65750 − 0.65470) / 0.65470` = **0,4277%** ← os "0,427%" observados |

Configurado: **0,30%**. O bot posicionou o TP 0,30% acima do preço do SINAL (`0.65563`), mas a entrada saiu 0,142% mais barata (`0.65470`), então o alvo real virou 0,443% — os 0,30% configurados **mais** a diferença sinal↔fill.

**O mesmo desvio se aplica ao Stop Loss**, na direção oposta: o risco real fica diferente do configurado, sem aviso.

### O que já está correto (não mexer)

- Caminho **LIMIT/buffer**: o monitor de fill já usa `actualEntryPrice` (linhas ~1247, ~1290 para Binance e ~1477+ para Bybit) e atualiza `entryPrice` com o preço real. Esse caminho está certo.
- `calculateTakeProfit()` em `take-profit.service.ts`: usa `trade.entryPrice` corretamente.

O defeito é **exclusivo do caminho MARKET fora da Binance**.

---

## REGRAS

1. Sem comentários em código. `npm run build` + testes verdes por fase.
2. Não alterar as fórmulas `calculateTakeProfitPrice` / `calculateStopLossPrice` — estão corretas; o que muda é o **preço base** passado para elas.
3. Se o preço real de execução não estiver disponível, **cair no comportamento atual** (preço do sinal) com `logger.warn` — nunca bloquear a criação de proteção.
4. Nada de mudança em quantidade, alavancagem, ou parâmetros de envio de ordem.

---

## FASE 1 — USAR O PREÇO REAL DE EXECUÇÃO EM TODAS AS CORRETORAS

1. Antes do bloco de proteção, garantir que `actualEntryPrice` esteja preenchido também para a **Bybit** em ordens MARKET:
   - Verificar o retorno de `bybitClient.createOrder` — se já trouxer `avgPrice`/`cumExecQty`, usar direto.
   - Se não trouxer, consultar a ordem recém-criada (`getOrderInfo` → fallback `getOrderHistory`, já existentes no client) com um pequeno retry (ex.: até 3 tentativas de 300ms) e extrair `avgPrice`.
   - Último recurso: ler o `avgPrice` da posição aberta na verificação que já existe no fluxo.
2. Trocar a condição por uma que não dependa da corretora:
   ```ts
   const priceForProtectionOrders = (!isLimitOrder && actualEntryPrice && !isAveragingTrade)
     ? actualEntryPrice
     : entryPrice;
   ```
3. Manter o log já existente que compara sinal × fill (linha ~2627), que passa a valer para as duas corretoras — ele mostra o slippage e facilita auditar.
4. Quando `actualEntryPrice` não for obtido em ordem MARKET, registrar `logger.warn('[PROTECTION ORDERS] Preço real de execução indisponível — TP/SL calculados sobre o preço do sinal')`.
5. **Averaging**: continua usando `entryPrice`? Não — quando `isAveragingTrade`, o correto é o **preço médio da posição** após o merge, não o preço do sinal. Avaliar no código onde o avgPrice pós-merge está disponível e usá-lo; se não estiver, manter o comportamento atual e registrar warning explícito (não silencioso).

## FASE 2 — AUDITORIA DETECTAR O DESVIO SOZINHA

`auditor/auditor.service.ts`:

1. Nova verificação por trade fechado: comparar o **TP% efetivo** (`|exitPrice − entryPrice| / entryPrice`, quando `closeReason` for `TAKE_PROFIT_*`) com o percentual configurado na estratégia. Se a diferença exceder 0,05 pontos percentuais, emitir issue `TP_PERCENT_MISMATCH` (WARNING; ERROR acima de 0,2 p.p.) com a mensagem mostrando configurado × efetivo.
2. Mesma verificação para `STOP_LOSS` → `SL_PERCENT_MISMATCH`.
3. Isso teria pego esse caso automaticamente — e pega qualquer regressão futura de preço base.

## FASE 3 — INCONSISTÊNCIAS DO CARD (investigar e corrigir)

Observadas no mesmo trade, todas a confirmar no código antes de alterar:

1. **Percentual da parcial errado**: a timeline mostra `TAKE PROFIT 1 — 890 @ 0.65760 (50.00000000%)`, mas 890 de 895 = **99,44%**. O `percentOfPosition` gravado na execução não corresponde à quantidade real fechada. Corrigir para derivar de `quantidade fechada ÷ quantidade da posição no momento`.
2. **PnL total menor que a parcial**: card mostra `+2.506` total e `+2.5955` só no TP1. O `PLANO_FIX_TP_REGISTRO` foi mergeado em 11/08/2026 e este trade é de 19/08 — ou seja, **existe um caminho de fechamento que aquele fix não cobriu**. Investigar qual (provável: fechamento via `position-sync` ou via o caminho que grava `closeReason: MANUAL`) e aplicar a mesma regra: PnL = soma dos líquidos reais das execuções.
3. **Motivo "MANUAL" com TP na timeline**: o trade fechou por TP mas foi rotulado MANUAL. Identificar o caminho que grava esse motivo e corrigir o rótulo quando houver execuções de TP registradas.

## FASE 4 — TESTES E ACEITE

1. Testes (jest, clientes mockados):
   - Bybit + MARKET + `avgPrice` disponível → TP e SL calculados sobre o fill real.
   - Bybit + MARKET + `avgPrice` indisponível → cai no preço do sinal **com warning**, sem quebrar.
   - Binance + MARKET → comportamento idêntico ao atual (zero regressão).
   - LIMIT/buffer → inalterado (já usa o fill real).
   - Auditor: trade com TP efetivo 0,443% e configurado 0,30% → issue `TP_PERCENT_MISMATCH`.
2. `npm run build` + suíte verde. Revisar o diff: nenhuma mudança em quantidade/alavancagem/parâmetros de ordem.
3. Aceite prático:
   - [ ] Novo trade MARKET na Bybit: TP efetivo no card = percentual configurado (tolerância de arredondamento de tick).
   - [ ] SL efetivo = percentual configurado.
   - [ ] Log mostra `Using actual filled price: X instead of signal price: Y` com o slippage.
   - [ ] Auditoria da estratégia sem `TP_PERCENT_MISMATCH` nos trades novos.
   - [ ] Percentual da parcial na timeline corresponde à quantidade fechada.

---

## OBSERVAÇÃO IMPORTANTE

Este defeito faz o **risco real divergir do configurado**: com SL de 1%, dependendo do slippage entre sinal e execução, o stop real pode ficar em 0,85% ou 1,15%. Em alavancagem alta isso muda materialmente a exposição. Vale priorizar a Fase 1.

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_FIX_TP_SL_PRECO_BASE.md na raiz e execute as FASES 1 a 4, uma por commit.

CONTEXTO: em webhook.service.ts (~linha 2621), priceForProtectionOrders só usa o
preço real de execução quando exchange === Exchange.BINANCE. Na Bybit, ordens
MARKET calculam TP e SL sobre o preço do SINAL — comprovado num trade real
SUIUSDT LONG: TP configurado 0,30% executou a 0,443% da entrada real.

REGRAS CRÍTICAS: não alterar as fórmulas calculateTakeProfitPrice/
calculateStopLossPrice (o que muda é o preço BASE passado a elas); se o preço
real de execução não estiver disponível, cair no comportamento atual COM warning,
nunca bloquear a criação de SL/TP; nenhuma mudança em quantidade, alavancagem ou
parâmetros de envio de ordem; Binance deve manter comportamento idêntico.

Sem comentários em código. npm run build + testes verdes por fase.
Liste mudanças por arquivo e o que cada teste cobre.
```
