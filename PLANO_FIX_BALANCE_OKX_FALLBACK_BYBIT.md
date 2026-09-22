# PLANO_FIX_BALANCE_OKX — O saldo da OKX está sendo pedido à Bybit

## 1. O BUG, NA LINHA EXATA

`webhook.service.ts` → `getAccountBalance()` (linha 145):

```ts
if (exchange === Exchange.BYBIT)  { ... }        // linha 161
if (exchange === Exchange.BINANCE) { ... }       // linha 170
  ...
} else {
  const client = this.exchangeFactory.get(Exchange.BYBIT);   // ← linha 233, HARDCODED
  const balance = await client.getWalletBalance(ctx);
}
```

**Não existe ramo para OKX.** Quando a estratégia é OKX, o código cai no `else` final — que é um fallback **fixo para a Bybit**. O bot pega as credenciais da OKX e as envia para `api.bybit.com`.

A Bybit recebe uma API Key que não é dela e responde **401**. É exatamente o que o log mostra:

```
[STRATEGY CONFIG] FF1 1M TESTE | Exchange: okx | ...
[ORDER CONFIG] Exchange: okx | orderType: MARKET | ...
[CREDENTIALS] source=portfolio portfolioId=74066353-...
[BybitClientService] [BYBIT] Time Sync Check:                    ← corretora errada
[BybitClientService] Attempting to fetch wallet balance...
[BYBIT] Wallet Balance Request Failed: HTTP Status: 401
  "X-BAPI-API-KEY": "f78f393d..."                                ← chave da OKX indo para a Bybit
```

E a stack confirma o caminho:
```
at BybitClientService.getWalletBalance (bybit-client.service.js:542)
at async WebhookService.getAccountBalance (webhook.service.js:241)
at async WebhookService._processSignalInternal (webhook.service.js:1855)
```

**Prova adicional:** no seu dashboard o saldo da OKX aparece corretamente (**10.00 USDT**). Isso porque o dashboard usa `portfolios.service` / `test-connection`, que passa pelo `ExchangeClientFactory` **certo**. Só o `getAccountBalance` do webhook ficou para trás na refatoração — ele é anterior à interface `ExchangeClient` e manteve o `if/else` binário Bybit-ou-Binance.

E no mesmo log, às 19:43:23, o `getWalletBalance` da Bybit **funciona** (6.59 USDT) — porque aí é a estratégia da Bybit, com as credenciais dela.

## 2. OS OUTROS TRÊS PROBLEMAS DO MESMO LOG

### 2.1 O 500 faz o TradingView reenviar o sinal ⚠️

```
19:43:06  Request 1789933386969-5y3dgk
19:43:12  Request 1789933392982-8438p
19:43:18  Request 1789933398996-5pms1j
```

Três execuções do **mesmo sinal** em 12 segundos. O bot devolve `500 Internal Server Error`, e o TradingView reenvia (é o que o print do Registro mostra: *"Entrega do webhook falhou — 500 Internal Server Error"*).

Hoje isso é inofensivo porque toda tentativa falha no saldo. **Depois da correção da Fase 1 vira perigoso:** o mesmo sinal poderia abrir três posições. O mutex não protege, porque ele libera o lock ao fim de cada requisição.

### 2.2 Stop Loss disparando em posição inexistente

```
[STOP-LOSS TRIGGERED] DOGEUSDT
├─ Entry: 0.08 → Exit: 0.09 (-8.74%)
[BYBIT] Failed to create order: current position is zero, cannot fix reduce-only order qty
```

Dois defeitos aqui:
- **Posição fantasma:** o trade existe no banco mas não na corretora — resíduo dos trades órfãos. O SL dispara e a Bybit recusa (`current position is zero`).
- **`-8,74%` é um número falso:** os preços no log estão truncados por `.toFixed(2)` (DOGE 0.08745 vira "0.08"), então o percentual foi calculado sobre valores arredondados. Mesma família do problema de precisão que já corrigimos nas ordens — sobrou nos logs.

### 2.3 Atenção ao tamanho mínimo na OKX

Sua estratégia: **10% da banca × 50x** sobre **10 USDT** = ~50 USDT de nocional → ~571 DOGE a 0.08745.

Na OKX a quantidade é em **contratos**, e o `DOGE-USDT-SWAP` costuma ter `ctVal = 1000` (1 contrato = 1000 DOGE). Se for o caso, 571 DOGE = **0,57 contratos — abaixo do mínimo de 1**, e a ordem será recusada por quantidade.

Isso não é bug; é dimensionamento. Vale conferir o `ctVal` real antes do primeiro sinal — a Fase 4 do `PLANO_FIX_PROXY_407_OKX` faz o `test-connection` devolver esse número.

---

## 3. REGRAS

1. Sem comentários em código. `npm run build` limpo e **≥ 472 testes verdes** por fase.
2. **Nenhum `exchangeFactory.get()` com corretora fixa fora da camada de exchange.**
3. Bybit e Binance não mudam de comportamento.

## FASE 1 — SALDO PELA CORRETORA CERTA (a correção)

`webhook.service.ts` → `getAccountBalance()`:

1. Remover o `else` da linha 232 que assume Bybit. A corretora sai **sempre** de `resolvedStrategy.exchange`:
   ```
   const client = this.exchangeFactory.get(exchange);
   const balance = await client.getWalletBalance(ctx);
   ```
2. O caminho da Binance (linhas 170-231) já funciona via `BinanceRequestUtil`; migrar para `client.getWalletBalance()` **preservando o resultado atual** — a suíte verde é o critério.
3. Se a corretora não tiver client registrado, **lançar erro explícito** (`"Corretora <x> sem client registrado"`), nunca cair em outra.
4. Corrigir o log `[BALANCE]` para nomear a corretora real, não "Bybit" fixo.
5. Testes: estratégia OKX → `getWalletBalance` do `OkxClient`; Bybit → Bybit; Binance → Binance; corretora desconhecida → erro claro, **nunca** fallback.

## FASE 2 — VARRER OUTROS FALLBACKS FIXOS

Este `else` sobreviveu à refatoração do `ExchangeClient`. Podem existir outros.

1. Buscar todo `exchangeFactory.get(Exchange.` com corretora **literal** fora de `src/exchange/`. Cada ocorrência deve passar a usar a corretora da estratégia, ou ser justificada por comportamento exclusivo daquela corretora (como o `setTradingStop` da Bybit no `position-sync:801`, que é legítimo).
2. Estender o teste-guarda que já existe (`exchange-conditional-guard.spec.ts`) para também falhar em `exchangeFactory.get(Exchange.<LITERAL>)` fora da camada de exchange, com uma allowlist explícita para os casos legítimos.

## FASE 3 — WEBHOOK NÃO PODE DEVOLVER 500 E CAUSAR REENVIO

1. Falha ao obter saldo (ou qualquer erro de pré-processamento) deixa de virar exceção não tratada: o controller responde **200** com `{ accepted: false, reason }` e registra a decisão no `signal_log`. O TradingView para de reenviar.
2. Reservar o 500 para falhas realmente inesperadas.
3. **Idempotência por sinal:** chave a partir de `strategyId + symbol + action + timestamp do candle`. Sinal repetido dentro de uma janela curta (sugestão: 60s) é **registrado e ignorado**, não executado. Isso protege contra o retry do TradingView e contra disparo duplicado do alerta.
4. Teste: três POSTs idênticos em 12s → **uma** execução, duas ignoradas com motivo no `signal_log`.

## FASE 4 — PRECISÃO NOS LOGS DE SL

`stop-loss.service.ts`:

1. Substituir os `.toFixed(2)` das mensagens de `[STOP-LOSS TRIGGERED]` por formatação pelo `tickSize` do símbolo (ou `toString()`), para DOGE não aparecer como `0.08`.
2. Recalcular o percentual exibido sobre os preços reais, não sobre os arredondados.
3. Antes de disparar o SL, confirmar que existe posição na corretora. Se não existir, **não tentar fechar**: marcar o trade para reconciliação e logar — em vez do erro `current position is zero, cannot fix reduce-only order qty`.

## FASE 5 — ACEITE

- [ ] Sinal em estratégia OKX busca o saldo **na OKX** (log `[BALANCE] okx: 10.00 USDT`)
- [ ] Nenhum `BybitClientService` no log de um sinal OKX
- [ ] Bybit e Binance continuam operando normalmente
- [ ] Webhook com falha de saldo devolve **200** com motivo, e o TradingView não reenvia
- [ ] Três sinais idênticos em 12s → uma execução só
- [ ] Log de SL mostra `0.08745`, não `0.08`
- [ ] SL sem posição na corretora não gera erro de reduce-only
- [ ] Build limpo e ≥ 472 testes verdes

---

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_FIX_BALANCE_OKX_FALLBACK_BYBIT.md na raiz e execute as FASES 1 a 5,
uma por commit. EXECUTE TODAS ATÉ O FIM.

BUG PRINCIPAL: webhook.service.ts getAccountBalance() (linha 145) trata apenas
Exchange.BYBIT (linha 161) e Exchange.BINANCE (linha 170). Não há ramo para OKX,
e o ELSE da linha 232 faz fallback HARDCODED para a Bybit:
  const client = this.exchangeFactory.get(Exchange.BYBIT);
Resultado: estratégia OKX manda as credenciais da OKX para api.bybit.com e recebe
401, derrubando o webhook com 500.

CONFIRMADO NO LOG DE PRODUÇÃO: "[STRATEGY CONFIG] ... Exchange: okx" seguido de
"[BybitClientService] [BYBIT] Attempting to fetch wallet balance" e
"HTTP Status: 401" com "X-BAPI-API-KEY: f78f393d..." (chave da OKX). Stack:
BybitClientService.getWalletBalance <- WebhookService.getAccountBalance.
PROVA ADICIONAL: o dashboard mostra o saldo da OKX corretamente (10.00 USDT)
porque usa portfolios.service/test-connection, que passa pelo factory certo —
só o getAccountBalance do webhook ficou para trás na refatoração do ExchangeClient.

FASE 1 — remover o else da linha 232. A corretora sai SEMPRE de
resolvedStrategy.exchange: exchangeFactory.get(exchange). Migrar o caminho da
Binance para client.getWalletBalance() preservando o resultado atual (suíte verde
é o critério). Corretora sem client registrado -> ERRO EXPLÍCITO, nunca fallback
para outra. Corrigir o log [BALANCE] para nomear a corretora real.

FASE 2 — varrer todo exchangeFactory.get(Exchange.<LITERAL>) fora de src/exchange/
e migrar para a corretora da estratégia, salvo casos legítimos de comportamento
exclusivo (ex.: setTradingStop da Bybit em position-sync:801). Estender o
exchange-conditional-guard.spec.ts existente para falhar nesse padrão, com
allowlist explícita.

FASE 3 — o webhook devolve 500 quando o saldo falha, e o TradingView REENVIA:
o log mostra o MESMO sinal executado 3x em 12s (19:43:06, 19:43:12, 19:43:18).
Hoje é inofensivo porque tudo falha; depois da FASE 1 abriria TRÊS POSIÇÕES.
Falha de pré-processamento passa a responder 200 com { accepted: false, reason }
e registro no signal_log. Adicionar IDEMPOTÊNCIA por strategyId + symbol + action
+ timestamp do candle, ignorando repetição dentro de 60s. Teste: 3 POSTs
idênticos em 12s -> UMA execução.

FASE 4 — stop-loss.service.ts: trocar os .toFixed(2) das mensagens
[STOP-LOSS TRIGGERED] por formatação pelo tickSize (DOGE aparece como 0.08, o que
tornou o "-8,74%" do log um número falso calculado sobre preços arredondados);
recalcular o percentual sobre os preços reais; e confirmar que existe posição na
corretora ANTES de disparar o SL, para não repetir o erro "current position is
zero, cannot fix reduce-only order qty".

REGRAS CRÍTICAS: nenhum exchangeFactory.get() com corretora fixa fora da camada de
exchange; Bybit e Binance não podem mudar de comportamento; nunca cair em outra
corretora por fallback — erro explícito é sempre melhor que corretora errada.

npm run build limpo e >= 472 testes verdes ao final de cada fase.
Sem comentários em código. Liste mudanças por arquivo e o que cada teste cobre.
```
