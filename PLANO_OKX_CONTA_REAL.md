# PLANO_OKX_CONTA_REAL — OKX como corretora de primeira classe, igual a Bybit e Binance

Objetivo: a OKX passa a funcionar direto em conta real, sem flag, sem tratamento especial — exatamente como Bybit e Binance.

---

## 1. AUDITORIA DE PARIDADE: JÁ EXISTE

Comparei o `OkxClientService` método a método contra a interface e contra o que Bybit e Binance fazem.

**Interface `ExchangeClient` — 21 métodos. A OKX implementa todos os que fazem sentido:**

| Método | Bybit | Binance | OKX |
|---|---|---|---|
| `createOrder`, `cancelOrder`, `cancelAllOrders`, `getOpenOrders` | ✅ | ✅ | ✅ |
| `getOrderInfo`, `getOrderHistory` | ✅ | ✅ | ✅ |
| `createStopLossOrder` | ✅ | ✅ | ✅ |
| `getPositions`, `waitForPosition`, `detectPositionMode`, `getPositionIdx` | ✅ | ✅ | ✅ |
| `setLeverage`, `setMarginMode`, `ensurePositionMode` | ✅ | ✅ | ✅ |
| `getWalletBalance`, `getCurrentPrice`, `getLastTradePrice` | ✅ | ✅ | ✅ |
| `getSymbolRules`, `getServerTime` | ✅ | ✅ | ✅ |
| `setTradingStop` / `clearTradingStop` | ✅ nativo | ❌ lança | ❌ lança |

Os dois últimos **não são um gap**: são um recurso exclusivo da Bybit (stop em nível de posição). **A Binance faz exatamente igual à OKX** — lança exceção e usa `createStopLossOrder`. É o padrão do projeto, não uma lacuna.

E o consumidor já trata isso corretamente. `position-sync.service.ts:801` (breakeven / break again):
```ts
if (strategy.exchange === Exchange.BYBIT && !trade.isFromAveraging) {
  await client.setTradingStop(...);
} else {
  if (trade.stopLossOrderId) await client.cancelOrder(...);   // ← OKX cai aqui, junto da Binance
  ...
}
```

**Conclusão: a OKX já é funcionalmente equivalente à Binance.** 62 testes específicos de OKX, 472 no total, todos verdes.

## 2. ENTÃO O QUE FALTA?

**Só a flag.** É a única coisa em todo o código que trata a OKX diferente das outras:

- `app.controller.ts:57` → `okxEnabled: process.env.OKX_ENABLED === 'true'`
- `portfolios.service.ts:113` → `assertOkxRealAllowed` recusa OKX + REAL sem a flag
- `portfolios/page.tsx:18` → desabilita a OKX inteira na UI

Bybit e Binance não têm nada disso. Você cria o portfólio Real e opera. A OKX passa a ser igual.

---

## 3. REGRAS

1. Sem comentários em código. `npm run build` limpo e **≥ 472 testes verdes** por fase.
2. **Não afrouxar a trava de modo `DEMO`/`REAL`** (`x-simulated-trading`) — ela não é uma trava de liberação, é o que garante que uma ordem marcada REAL vá para a conta real e uma DEMO não. Bybit e Binance têm o equivalente (domínio de testnet). **Permanece.**
3. Bybit, Binance e BingX não mudam de comportamento.
4. BingX continua desabilitada — para ela realmente não há client.

---

## FASE 1 — REMOVER A FLAG

1. `portfolios.service.ts`: apagar `assertOkxRealAllowed` e suas chamadas. Portfólio OKX `REAL` é criado como qualquer outro.
2. `app.controller.ts`: remover `okxEnabled` de `/public-config`.
3. `frontend/lib/api.ts`: remover `okxEnabled` do tipo e do consumo.
4. `frontend/app/portfolios/page.tsx`: `buildExchangeOptions` deixa de receber parâmetro — **OKX El Salvador entra ao lado de Bybit e Binance, sem rótulo e sem `disabled`**. BingX permanece "(em breve)". Remover o estado `okxEnabled` e a chamada que o alimentava.
5. Remover `OKX_ENABLED` do README e de qualquer `.env.example`.
6. Atualizar os testes que exercitavam a flag: passam a verificar que **OKX REAL é aceita sem nenhuma variável de ambiente**.

## FASE 2 — VALIDAR OS PONTOS QUE SÓ A API REAL EXERCITA

A implementação foi construída e testada com mocks. Três pontos da API da OKX diferem estruturalmente de Bybit e Binance e precisam estar corretos antes da primeira ordem real:

### 2.1 Quantidade em contratos (o mais importante)

Na OKX, `sz` é em **contratos**, não na moeda base. A conversão depende de `ctVal` e `ctMult` do instrumento — um perpétuo de SUI pode ter `ctVal = 1` (1 contrato = 1 SUI) ou outro valor. Bybit e Binance recebem a quantidade na própria moeda; **este é o único lugar onde a OKX exige uma tradução que as outras não exigem.**

1. Conferir que `okx-symbol.util.ts` aplica `ctVal`/`ctMult` nas duas direções: quantidade → contratos ao enviar, contratos → quantidade ao ler posições, fills e `getPositions`.
2. Teste com `ctVal` diferente de 1 — se todos os testes atuais usam `ctVal = 1`, o erro de fator passa despercebido.
3. Garantir que `planTakeProfits` recebe `lotSz` (step de contratos) e que as fatias de TP somam exatamente a posição **em contratos**.

### 2.2 Precisão e filtros

`getSymbolRules` deve mapear `lotSz` → step, `minSz` → minQty, `tickSz` → priceTick e o nocional mínimo, no mesmo formato que `SymbolRulesService` já consome. O guarda de `toFixed(` já cobre a formatação; confirmar que a OKX passa por `exchange-precision.util`.

### 2.3 Herança das correções anteriores

Confirmar por teste que a OKX usa os mesmos caminhos já corrigidos, sem código paralelo:
- preço base de SL/TP pelo **fill real** + reposicionamento quando diverge
- PnL lido da corretora (`mapOkxFill` no `fill.util.ts`)
- `position-sync`, reset e auditor (`SL_PERCENT_MISMATCH`, `TP_PERCENT_MISMATCH`, `MISSING_TP_ORDERS`)
- buffer com ordem LIMIT e sem expiração por tempo

## FASE 3 — VISIBILIDADE NA ESTREIA

Não é trava — é instrumentação, e some depois que você confiar na integração.

1. Na **primeira ordem de cada portfólio OKX**, logar em `warn`:
   ```
   [OKX] PRIMEIRA ORDEM | mode=REAL simulated=ausente | instId=SUI-USDT-SWAP
         sz=<contratos> ctVal=<x> -> <moedas> | nocional=<usdt>
   ```
   Contratos, `ctVal` e nocional lado a lado — é o que denuncia um erro de conversão na hora, antes da segunda ordem.
2. `POST /portfolios/:id/test-connection` passa a devolver `ctVal`, `ctMult`, `lotSz`, `minSz` e `tickSz`, permitindo conferir os números **antes** de qualquer ordem.
3. Auditor roda para OKX desde a primeira operação.

## FASE 4 — ACEITE

- [ ] OKX El Salvador aparece no select **sem rótulo e sem estar apagada**, ao lado de Bybit e Binance
- [ ] Portfólio OKX **Real** criado sem nenhuma variável de ambiente
- [ ] `Testar conexão` devolve saldo correto + `ctVal`, `lotSz`, `minSz`, `tickSz`
- [ ] Ordem MARKET: SL e TP criados sobre o **fill real**, com os percentuais configurados
- [ ] Ordem LIMIT com buffer: preenche e a proteção nasce alinhada ao fill
- [ ] Quantidade na OKX = quantidade pretendida (conferir contratos × `ctVal`)
- [ ] Ciclo completo: PnL do card idêntico ao `Closed P&L` da OKX
- [ ] Auditoria sem issues nos trades novos
- [ ] Build limpo e ≥ 472 testes verdes

---

## 4. NO RAILWAY

Nada a configurar. Com a flag removida, a OKX funciona como Bybit e Binance: basta cadastrar o portfólio com API Key, Secret, **Passphrase** e a região El Salvador.

Se `OKX_ENABLED` já estiver definida lá, pode remover:
```
railway variables --unset OKX_ENABLED
railway redeploy
```

**Na primeira ordem**, procure a linha `[OKX] PRIMEIRA ORDEM` no log e confira se o nocional bate com o pretendido. É o único ponto onde a OKX pode divergir das outras duas, por causa dos contratos — e se divergir, se repetirá identicamente em todas as ordens seguintes.

---

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_OKX_CONTA_REAL.md na raiz e execute as FASES 1 a 4, uma por commit.

OBJETIVO: a OKX passa a funcionar direto em CONTA REAL, sem flag e sem tratamento
especial — exatamente como Bybit e Binance.

AUDITORIA JÁ FEITA: a paridade funcional JÁ EXISTE. O OkxClientService implementa
todos os métodos da interface ExchangeClient. setTradingStop/clearTradingStop
lançam exceção, mas isso NÃO é um gap: a Binance faz idêntico (é recurso
exclusivo da Bybit), e position-sync.service.ts:801 já trata — só a Bybit usa
setTradingStop, todas as outras caem no else que cancela e recria a ordem de SL.
62 testes de OKX, 472 no total, verdes.

O QUE FALTA É SÓ A FLAG. Ela é a única coisa no código que trata a OKX diferente:
- app.controller.ts:57  -> okxEnabled: process.env.OKX_ENABLED === 'true'
- portfolios.service.ts:113 -> assertOkxRealAllowed recusa OKX + REAL sem a flag
- frontend/app/portfolios/page.tsx:18 -> desabilita a OKX inteira

FASE 1 — remover TODOS esses pontos. Apagar assertOkxRealAllowed e suas chamadas;
remover okxEnabled de /public-config, de frontend/lib/api.ts e do estado da
página; buildExchangeOptions deixa de receber parâmetro e a OKX entra ao lado de
Bybit e Binance, SEM rótulo e SEM disabled. BingX continua "(em breve)". Remover
OKX_ENABLED do README e dos .env.example. Atualizar os testes da flag para
verificar que OKX REAL é aceita SEM nenhuma variável de ambiente.

FASE 2 — validar o que só a API real exercita. O ponto crítico é que na OKX o sz
é em CONTRATOS, não na moeda base: depende de ctVal/ctMult do instrumento. Bybit
e Binance recebem a quantidade na própria moeda — é a ÚNICA tradução que a OKX
exige e as outras não. Conferir que okx-symbol.util.ts aplica ctVal/ctMult nas
DUAS direções (quantidade->contratos ao enviar; contratos->quantidade ao ler
posições, fills e getPositions) e ADICIONAR TESTE COM ctVal DIFERENTE DE 1 — se
todos os testes atuais usam ctVal=1, um erro de fator passa despercebido.
Confirmar que planTakeProfits recebe lotSz e que as fatias somam a posição exata
em contratos. Confirmar que a OKX herda, sem código paralelo: preço base pelo
fill real + reposicionamento, PnL lido da corretora (mapOkxFill), position-sync,
reset, auditor e buffer.

FASE 3 — instrumentação de estreia (não é trava): na primeira ordem de cada
portfólio OKX, logar em warn "[OKX] PRIMEIRA ORDEM | mode=REAL simulated=ausente
| instId=... | sz=<contratos> ctVal=<x> -> <moedas> | nocional=<usdt>".
test-connection passa a devolver ctVal, ctMult, lotSz, minSz e tickSz. Auditor
roda para OKX desde a primeira operação.

REGRAS CRÍTICAS: NÃO afrouxar a trava de modo DEMO/REAL (x-simulated-trading) —
ela não é trava de liberação, é o que garante que uma ordem REAL vá para a conta
real; Bybit e Binance têm o equivalente via domínio de testnet. Bybit, Binance e
BingX não mudam de comportamento. BingX continua desabilitada.

npm run build limpo e >= 472 testes verdes ao final de cada fase.
Sem comentários em código. Liste mudanças por arquivo e o que cada teste cobre.
```
