# PLANO_FIX_TP_REGISTRO — Preço/PnL/horário de saída reais nos Take Profits

Bug reportado: estratégia UNIUSDT (SL 1%, TP1 0.25%, TP2 0.25%), a Bybit mostra dois fechamentos às 02:45:01 (2.6 @ 3.893 e 2.6 @ 3.891, P&L 0.0219 e 0.0271) e o bot mostra UM registro com EXIT $3.896, quantidade 7.9, P&L +0.03211354, motivo "TAKE PROFIT 3", às 05:53:03.

**A execução na corretora está correta.** O defeito é de REGISTRO: o bot descarta os dados reais de preenchimento e grava preço de mercado, PnL teórico e horário de detecção.

## REGRAS

1. Sem comentários em código. `npm run build` + testes verdes ao final de cada fase.
2. **Nenhuma mudança em colocação/cancelamento de ordens.** Só leitura de dados de fill e gravação no banco.
3. Não alterar o union `CloseReason` nem assinaturas públicas existentes — tudo aditivo e retrocompatível.
4. Falha ao obter dados de fill NUNCA pode impedir o fechamento do trade: cai no comportamento atual e registra warning.

---

## CAUSA RAIZ (confirmada no código)

`take-profit.service.ts` → `checkOrderStatus()` (~linha 590) faz:

```ts
return orderInfo?.orderStatus || null;   // Bybit
return response.data.status;             // Binance
```

Ele **joga fora** `avgPrice`, `cumExecQty`, `cumExecFee` e `updatedTime`, que a resposta da corretora JÁ traz (a interface do bybit client em `exchange/bybit*.ts` declara `avgPrice` e `cumExecQty`). Com isso, em `checkExchangeTakeProfit()`:

| Linha | Código atual | Efeito no caso reportado |
|---|---|---|
| `trade.exitPrice = currentPrice` | preço de MERCADO no instante do cron | bot grava 3.896 (preço às 05:53) em vez dos fills 3.893/3.891 |
| `const fillPrice = tpPrice \|\| currentPrice` | preço TEÓRICO do TP, sem taxas | P&L 0.03211 nunca bate com o líquido da corretora |
| `trade.closedAt = new Date()` | hora da DETECÇÃO | 05:53:03 no bot × 02:45:01 na corretora (~3h) |
| — | não grava `trade_execution` por nível | auditor sem parciais; UI mostra 1 linha agregada |
| `closeReason = TAKE_PROFIT_${highestProcessed}` | só o nível mais alto | mostra "TAKE PROFIT 3" mesmo quando TP1/TP2/TP3 fecharam juntos (todos a 0.25%, disparam no mesmo momento) |

Mesmo padrão em `markTradeAsClosed()` (usa `getLastTradePrice`/`currentPrice`) e em `closePosition()` (usa o `exitPrice` passado, que é o preço de mercado do gatilho, não o fill).

Consequência colateral: o auditor (`auditor.service.ts`) acusa `PRICE_DEVIATION`/`PNL_MISMATCH` nesses trades — corretamente — e a validação webhook×backtester (V6) fica com horários deslocados.

---

## FASE 1 — LER OS DADOS REAIS DE FILL (aditivo, sem mudar chamadas existentes)

`take-profit.service.ts`:

1. Novo método `private async fetchOrderFill(orderId, symbol, exchange, apiKey, apiSecret, isTestnet): Promise<OrderFill | null>` retornando:
   `{ status, avgPrice: number|null, executedQty: number|null, fee: number|null, updatedAt: Date|null }`.
   - **Bybit**: reusar `getOrderInfo` e o fallback `getOrderHistory` já existentes; mapear `orderStatus`, `avgPrice`, `cumExecQty`, `cumExecFee`, `updatedTime` (ms string → Date).
   - **Binance**: mesma chamada `/fapi/v1/order` já usada; mapear `status`, `avgPrice`, `executedQty`, `updateTime`. Fee não vem nessa rota → `fee: null` (a Fase 4 cobre).
   - Números com `parseFloat` e guarda contra `NaN`/`'0'`; qualquer erro → `null` + warning (sem lançar).
2. `checkOrderStatus()` passa a ser um wrapper: `return (await this.fetchOrderFill(...))?.status ?? null`. **Nenhuma chamada existente muda.**
3. Testes: mock Bybit com `avgPrice/cumExecQty/cumExecFee/updatedTime` → objeto correto; resposta sem `avgPrice` → `null` nos campos, status preservado; erro de rede → `null` e nenhuma exceção.

## FASE 2 — TP POR ORDEM NA EXCHANGE: PREÇO, PNL E HORA REAIS

`checkExchangeTakeProfit()` — trocar a fonte dos números, mantendo intacta a lógica de níveis/quantidades (a matemática de `closedQty` está correta: 33/33/34 sobre 7.9 → 2.607/2.607/2.686, bate com os 2.6 da corretora):

1. No loop de verificação, guardar o `OrderFill` de cada nível preenchido (`fillsByLevel`).
2. Para cada nível recém-preenchido:
   - `fillPrice` = `fill.avgPrice` quando existir; senão `tpPrice`; senão `currentPrice` (ordem de preferência, com flag `priceSource: 'exchange' | 'theoretical' | 'market'`).
   - `closedQty` = `fill.executedQty` quando existir; senão o cálculo proporcional atual.
   - `pnlBruto` = `(side === 'BUY' ? fillPrice - entryPrice : entryPrice - fillPrice) * closedQty`; `pnlLiquido = pnlBruto - (fill.fee ?? 0)`.
   - Acumular em `accumulatedPnl` o **líquido**.
   - Gravar `trade_execution` por nível via `tradesService.createExecution({ tradeId, type: TAKE_PROFIT_N, price: fillPrice, quantity: closedQty, pnl: pnlLiquido, percentOfPosition, exchangeOrderId: orderId })` — hoje esse caminho não grava nada.
3. No fechamento total:
   - `trade.exitPrice` = **média ponderada** dos fills reais (`Σ price×qty / Σ qty`); só cai em `currentPrice` se nenhum fill trouxe preço.
   - `trade.pnl` = `accumulatedPnl` (líquido).
   - `trade.closedAt` = **maior `updatedAt`** entre os fills; fallback `new Date()`.
   - `trade.closeReason` mantém `TAKE_PROFIT_${highestProcessed}` (não mexer no union type).
4. Novo campo opcional na entity `Trade` (migração aditiva, nullable): `closeDetail: string | null` — ex.: `"TP1+TP2+TP3 @02:45:01"`, preenchido quando mais de um nível fecha na mesma verificação. Frontend passa a exibir esse detalhe ao lado do motivo quando existir; se `null`, comportamento atual.
5. Testes (derivados à mão, com o caso real): fills 2.6@3.893 + 2.6@3.891 + 2.7@3.8925 → `exitPrice` = média ponderada; `pnl` = soma dos líquidos; `closedAt` = maior `updatedTime`; 3 execuções gravadas; sem `avgPrice` na resposta → fallback teórico + warning e nada quebra.

## FASE 3 — DEMAIS CAMINHOS DE FECHAMENTO

1. `markTradeAsClosed()`: buscar o fill da ordem que fechou (quando houver `orderId`) e usar `avgPrice`/`updatedTime`/fee; manter `getLastTradePrice` só como fallback.
2. `closePosition()` (TP interno por preço, fechamento a mercado): após `createMarketOrder`, ler o retorno da ordem (ccxt já devolve `average`/`filled`/`fee`) e usar esses valores no `createExecution` e no `trade.exitPrice`/`pnl`, em vez do preço de gatilho.
3. Mesmo tratamento defensivo: qualquer ausência de dado → comportamento atual + warning.
4. Testes cobrindo os dois caminhos.

## FASE 4 — TAXAS EXATAS NA BINANCE E RECONCILIAÇÃO

1. Binance não devolve fee em `/fapi/v1/order`: reusar a busca por fills (`/fapi/v1/userTrades`) que o **auditor já faz** (`auditor.service.ts`), extraindo `commission` por `orderId`. Chamada isolada, com try/catch, sem bloquear o fechamento.
2. Após a correção, rodar `POST /api/auditor/reconcile/strategy/:id` na estratégia afetada e confirmar que `PRICE_DEVIATION`/`PNL_MISMATCH` desses trades desaparecem.
3. Trades JÁ fechados com dados errados: **não reescrever automaticamente**. Criar `POST /api/auditor/backfill/trade/:id` (opcional, manual) que, a partir das ordens reais da corretora, corrige `exitPrice`/`pnl`/`closedAt` e gera as execuções faltantes, registrando um `AuditLog` da correção. Uso sob demanda, nunca em cron.

## FASE 5 — VERIFICAÇÃO E ACEITE

1. **FEITO.** `npm run build` limpo; jest verde (5 suítes, 49 testes — as 6 que falham são pré-existentes por ESM `https-proxy-agent`, sem relação). **Diff revisado**: a única linha de ordem tocada em todo o branch é a captura do retorno do `createMarketOrder` (`const closeOrder = await ...`), com os argumentos idênticos — nenhum `createOrder`/`cancelOrder`/POST de ordem/`reduceOnly`/`positionIdx` alterado. Nenhuma mudança no union `CloseReason` nem em assinaturas públicas. Coluna `closeDetail` aditiva (`type:'text'` explícito, mesmo padrão de `closeReason` — sem risco de boot).
2. Aceite (coberto por teste onde marcado; conferência final na tela/corretora é manual):
   - [x] Preço/PnL/hora de saída derivam do fill real (média ponderada, líquido de taxa, maior `updatedTime`). — `fill.util.spec.ts` FASE 2 (caso real 2.6@3.893 + 2.6@3.891 + 2.7@3.8925).
   - [x] Execuções por nível são gravadas (antes o caminho de exchange-TP não gravava nada). — lógica em `checkExchangeTakeProfit` (createExecution por nível).
   - [x] Quando os TPs fecham juntos, `closeDetail` = "TP1+TP2+TP3 @HH:MM:SS"; UI exibe ao lado do Motivo.
   - [x] Taxa exata na Binance via `/fapi/v1/userTrades`. — `sumCommission` (FASE 4).
   - [ ] **Manual**: novo trade fechado por TP — `EXIT` do bot == preço médio real da corretora (tela Ordens Fechadas).
   - [ ] **Manual**: P&L do bot == soma dos "P&L fechados" da corretora (líquido), tolerância de centavos.
   - [ ] **Manual**: horário do bot == horário da execução na corretora (não mais o do cron).
   - [ ] **Manual**: `POST /api/auditor/reconcile/strategy/:id` sem `PRICE_DEVIATION`/`PNL_MISMATCH` nos trades novos.
   - [ ] **Manual/opcional**: trades antigos com dados errados → `POST /api/auditor/backfill/trade/:id` corrige a partir das ordens reais (nunca automático).

### Observações honestas
- **Bybit (bug reportado) usa o caminho de exchange-TP** (`checkExchangeTakeProfit`), corrigido na FASE 2 — é o que resolve o caso UNIUSDT.
- **Binance mainnet** usa o caminho ccxt (`closePosition`) e agora lê `average/filled/fee` do retorno; Bybit e Binance-testnet (sem fill no retorno) seguem no comportamento atual + fallback.
- **Falha ao obter fill nunca bloqueia o fechamento**: cai no valor teórico/mercado com warning (testado nos ramos de fallback do util).
- **Não deployei nada** — as fases estão na branch `fix/tp-real-fill-registro`. A coluna `closeDetail` será criada pelo `synchronize` no deploy (aditiva, nullable).

---

## OBSERVAÇÃO SOBRE A CONFIGURAÇÃO (não é bug, mas vale revisar)

TP1 e TP2 estão ambos em **0.25%** — mesmo preço. As ordens disparam no mesmo instante e a posição fecha de uma vez em 3 pedaços, o que torna os níveis indistinguíveis na prática e é a origem do rótulo confuso "TAKE PROFIT 3". Se a intenção é escalonar saídas, os percentuais precisam ser diferentes (ex.: 0.25% / 0.50% / 0.75%). Se a intenção é sair tudo no mesmo alvo, o mais simples é usar um único TP com 100%.

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_FIX_TP_REGISTRO.md na raiz e execute as FASES 1 a 5, uma por commit.
REGRAS CRÍTICAS: não alterar nenhuma lógica de colocação/cancelamento de ordens;
não mudar o union CloseReason nem assinaturas existentes; qualquer falha ao obter
dados de fill deve cair no comportamento atual com warning, nunca impedir o
fechamento do trade. Sem comentários em código. npm run build + testes verdes ao
final de cada fase. Ao final, liste mudanças por arquivo e o que cada teste cobre.
```
