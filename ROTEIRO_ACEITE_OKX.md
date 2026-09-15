# Roteiro de aceite — PLANO_INTEGRACAO_OKX (FASE 7)

Este roteiro valida o `OkxClientService` contra uma conta demo real da OKX antes de
qualquer ordem OKX ser considerada confiável. Ele é o item 2 da FASE 7 do
`PLANO_INTEGRACAO_OKX.md`.

## Status atual (leia antes de tentar rodar isto)

A OKX está **desabilitada na UI** (`disabled: true` no seletor de corretora) e a
criação de portfólio OKX `REAL` está **bloqueada** por `OKX_ENABLED` (FASE 4), que não
está setada em lugar nenhum ainda. Isso é proposital — ver `PLANO_INTEGRACAO_OKX.md`
regra 4 e 5.

Além disso, o **fluxo completo de execução de ordem** (`webhook.service.ts`) ainda só
tem dois ramos: Bybit (via `ExchangeClient` genérico) e Binance (código cru
específico). A FASE 6 **decidiu deliberadamente não ligar a OKX nesse fluxo ainda** —
ligar só a criação da ordem de entrada sem ligar SL/TP/buffer/reprice criaria um
estado pior que o atual (posição aberta de verdade na corretora, sem proteção, porque
o código de SL/TP cairia no ramo `else` específico da Binance). Ver a mensagem do
commit da FASE 6 para o raciocínio completo.

Isso significa que, **hoje**, dá para validar contra uma conta demo real:

- [x] **Conexão e saldo** — `OkxClientService.getWalletBalance` via
      `POST /portfolios/:id/test-connection`, já implementado e testado.
- [ ] Todo o resto do checklist abaixo (ordens MARKET/LIMIT, SL/TP, buffer, reprice,
      PnL, auditoria) **exige primeiro** escrever o equivalente de
      `executeBybitOrder`/`scheduleBybitProtectionOrders` para a OKX em
      `webhook.service.ts` — trabalho futuro, fora do escopo da FASE 6, a ser feito
      com o mesmo cuidado (migração mecânica, testes a cada passo) da FASE 2.

Portanto este roteiro está dividido em duas partes: **Parte A** (roda hoje, só
precisa de uma API key demo da OKX) e **Parte B** (o checklist completo do plano,
que fica pendente até o fluxo de execução ganhar o terceiro ramo).

---

## Como conseguir uma API Key demo da OKX

1. Crie uma conta em [okx.com](https://www.okx.com) (ou use uma existente).
2. No changer de ambiente do site/app, ative o modo **Demo Trading** (fica no menu
   de perfil — não é uma URL/domínio diferente, é o mesmo `www.okx.com`).
3. Vá em **Profile → API** e crie uma API Key **dentro do modo Demo**. A OKX exige:
   - **Passphrase** (você define na criação — anote, não tem como recuperar depois).
   - Permissões: marque **Trade** (não precisa de Withdraw).
   - Sem restrição de IP se você for testar de máquinas variáveis; com restrição de
     IP se o backend tiver IP fixo (Railway com proxy dedicado, ver `ProxyUtil`).
4. Guarde os três valores (API Key, Secret, Passphrase) — vão para os três campos do
   formulário de portfólio (`API Key`, `Secret Key`, `Passphrase`).

## Como habilitar a OKX temporariamente para o teste (Parte A)

A opção "OKX El Salvador" está `disabled` no dropdown do formulário
(`frontend/app/portfolios/page.tsx`, array `EXCHANGE_OPTIONS`). Para testar antes da
FASE 8 liberar oficialmente, escolha uma das duas:

- **Opção rápida (recomendada)**: comente a linha `disabled: true` da entrada `okx`
  em `EXCHANGE_OPTIONS` localmente, rode o frontend, crie o portfólio pela UI, e
  desfaça o comentário depois. Não commitar essa mudança.
- **Opção via API**: `POST /portfolios` direto (curl/Postman) com
  `{ "name": "OKX Demo Test", "exchange": "okx", "mode": "DEMO", "apiKey": "...",
  "apiSecret": "...", "apiPassphrase": "...", "region": "EL_SALVADOR" }`. O modo
  `DEMO` não passa pela trava do `OKX_ENABLED` (essa trava é só para `REAL`).

## Parte A — testável hoje

- [ ] `POST /portfolios` cria o portfólio OKX demo com sucesso (region `EL_SALVADOR`,
      `EEA` ou `US` conforme a conta).
- [ ] `POST /portfolios/:id/test-connection` retorna `{ success: true, balance: <n> }`
      com o saldo USDT real da conta demo.
- [ ] Log `[OKX] getWalletBalance mode=DEMO simulated=1` aparece no backend (FASE 4,
      ponto 3 — confirma que o header foi montado corretamente para essa chamada).
- [ ] Trocar a `apiPassphrase` para um valor errado → `test-connection` retorna
      `{ success: false, message: "..." }` (nunca lança 500, nunca trava o processo).
- [ ] Criar o portfólio com `region: "EEA"` e confirmar (via log ou proxy/mitm local)
      que a chamada foi para `eea.okx.com`, não `www.okx.com`.

## Parte B — checklist completo do plano (pendente do fluxo de execução)

Cada item abaixo só é executável depois que `webhook.service.ts` ganhar o terceiro
ramo (OKX) espelhando `executeBybitOrder` + `scheduleBybitProtectionOrders`. Mantidos
aqui como está no plano original, para não perder o checklist de referência:

- [ ] Ordem MARKET: SL e TP criados sobre o **fill real**.
- [ ] Ordem LIMIT com buffer: preenche e a proteção nasce alinhada ao fill.
- [ ] Buffer preenchendo muito depois → SL **reposicionado** (`[SL REPRICE]` no log).
- [ ] TP1/TP2/TP3 parciais somando exatamente a posição, sem resíduo.
- [ ] SL disparando com o percentual configurado (±tick).
- [ ] PnL do card idêntico ao da OKX.
- [ ] Sinal contrário cancelando a ordem com buffer.
- [ ] Reinício do processo com ordem pendente → proteção criada no fill.
- [ ] Auditoria sem issues nos trades novos.

## Testes automatizados (verdes hoje)

- `npm run build` limpo.
- Suíte completa: `npx jest` — 469 testes verdes.
- Cobertura específica da OKX (FASE 5/6/7):
  - `src/exchange/okx-signing.util.spec.ts` — assinatura HMAC-SHA256 Base64
    reproduzindo exatamente o algoritmo documentado (`timestamp+method+path+body`),
    normalização de method, timestamp ISO 8601.
  - `src/exchange/okx-symbol.util.spec.ts` — `instId` ↔ símbolo interno, quantidade
    ↔ contratos via `ctVal`/`ctMult` com `lotSz` fracionário e inteiro.
  - `src/exchange/okx-mode.util.spec.ts` — trava DEMO/REAL: builder, guard nos dois
    sentidos, mode indefinido sempre lança, logger nos dois modos.
  - `src/exchange/okx-client.service.spec.ts` — 33 testes: `createOrder`/
    `createStopLossOrder` (one-way e hedge, positionSide correto em fechamento),
    `cancelOrder` (algo-primeiro-fallback-regular), `getPositions`, `getWalletBalance`,
    domínio por região, integração da trava de modo em toda chamada privada.
  - `src/webhook/okx-tp-planning.scenario.spec.ts` — `planTakeProfits` com
    `lotSz`/`ctVal` reais da OKX (BTC-USDT-SWAP, SUI-USDT-SWAP), TPs somando
    exatamente a posição, descarte por `BELOW_MIN_NOTIONAL`.
  - `src/common/symbol-rules.service.spec.ts` — branch OKX com cache e fallback.
  - `src/portfolios/portfolios.service.spec.ts` — `testConnection` OKX (com e sem
    passphrase), validação de passphrase obrigatória, trava de `OKX_ENABLED` para
    portfólio REAL.

## Nota sobre a assinatura HMAC (honestidade sobre o vetor de teste)

O teste de assinatura em `okx-signing.util.spec.ts` reproduz o algoritmo documentado
pela OKX (`Base64(HMAC-SHA256(secret, timestamp+method+requestPath+body))`) e
verifica contra o resultado do próprio `crypto.createHmac` do Node — ou seja, prova
que a implementação segue o algoritmo corretamente, mas **não foi validado contra um
vetor oficial publicado pela documentação da OKX** (não havia acesso à documentação
ao vivo durante a implementação). Isso só é confirmado de verdade quando a Parte A
deste roteiro rodar contra a API real e a assinatura for aceita (isto é, quando
`test-connection` retornar `success: true` em vez de erro `50113 Invalid signature`).
