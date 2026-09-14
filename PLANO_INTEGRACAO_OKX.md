# PLANO_INTEGRACAO_OKX — Interface de corretoras + OKX El Salvador

## 1. POR QUE APARECE "(EM BREVE)"

**Fui eu que instruí isso.** No `PLANO_PORTFOLIOS_E_LAYOUT.md` escrevi:

> "o protótipo lista OKX e BingX, mas o bot só implementa Binance e Bybit. Este plano cria a estrutura para as quatro e **expõe apenas as duas suportadas** — as outras entram desabilitadas com rótulo 'em breve'."

O enum `Exchange` já tem `OKX = 'okx'` e `BINGX = 'bingx'`, e o `ExchangeService` (CCXT) existe — mas **não há nenhum client de execução para OKX**. Se a opção fosse habilitada como está, o usuário cadastraria o portfólio, a estratégia receberia o webhook e a ordem simplesmente falharia. O rótulo é honesto: a estrutura existe, a execução não.

## 2. O TAMANHO REAL DO PROBLEMA

O bot foi construído em cima de uma premissa binária: **ou é Bybit, ou é Binance.**

| Arquivo | Pontos com `Exchange.BYBIT` / `Exchange.BINANCE` |
|---|---|
| `webhook.service.ts` | 29 |
| `take-profit.service.ts` | 22 |
| `stop-loss.service.ts` | 19 |
| `position-sync.service.ts` | 14 |
| `trades.controller.ts` | 7 |
| outros | ~30 |

São **~120 condicionais** espalhadas por 12+ arquivos. Adicionar uma terceira corretora nesse modelo transforma cada `if/else` num `switch` de quatro ramos — e **toda correção futura teria que ser feita quatro vezes**. Foi exatamente esse padrão (lógica duplicada por corretora) que gerou a família de erros do `toFixed()` que levamos semanas caçando.

Por isso: **interface primeiro, corretora depois.**

## 3. O QUE A OKX EXIGE E O BOT NÃO TEM

Pesquisei a documentação da API v5. A OKX não é "mais uma corretora" — ela quebra três premissas do código atual:

### 3.1 Uma terceira credencial (passphrase)

Requisições privadas exigem **quatro** headers: `OK-ACCESS-KEY`, `OK-ACCESS-SIGN`, `OK-ACCESS-TIMESTAMP` e **`OK-ACCESS-PASSPHRASE`**.

A passphrase é definida na criação da API Key e é obrigatória. **O `Portfolio` de hoje só tem `apiKey` e `apiSecret`** — falta um terceiro campo criptografado.

### 3.2 Assinatura e timestamp diferentes

| | Bybit | Binance | **OKX** |
|---|---|---|---|
| Payload assinado | `ts + key + recv + qs` | query string | **`ts + method + requestPath + body`** |
| Codificação | hex | hex | **Base64** |
| Timestamp | epoch ms | epoch ms | **ISO 8601 UTC** |

Nenhum utilitário de assinatura atual serve — precisa ser escrito do zero.

### 3.3 Demo é header, não domínio ⚠️ — o ponto mais perigoso

Bybit e Binance têm domínios de testnet separados. **A OKX não.** Demo usa o **mesmo** `www.okx.com`, diferenciado apenas pelo header:

```
x-simulated-trading: 1
```

E a documentação é explícita: **sem esse header, a requisição autenticada vai para a conta REAL.**

Traduzindo para o nosso caso: se o mapeamento `mode: 'DEMO'` → header falhar em **um único** ponto do código, o bot **envia ordem com dinheiro real achando que está em demo**. Este é o maior risco de todo o projeto e precisa de uma trava dedicada, não de um `if` espalhado.

### 3.4 Domínio por região (o mesmo problema do `x-site-id`)

A OKX roteia por entidade: `eea.okx.com` (EU), `us.okx.com` (US/AU), `okx.com` (global). E "conta El Salvador" é **exatamente o mesmo padrão da Bybit Brasil**: o usuário brasileiro mantém a conta BR e abre uma conta offshore em El Salvador ("1 login – 2 contas") para acessar derivativos não oferecidos no Brasil.

Isso conecta ao **GAP B** da auditoria anterior (o `x-site-id` da Bybit ainda é uma env global). A interface precisa carregar o conceito de **entidade/região** desde o início — para as duas corretoras.

---

## 4. REGRAS

1. Só adicionar. **320 testes verdes** e `npm run build` limpo ao final de cada fase.
2. Sem comentários em código.
3. **Binance e Bybit não podem mudar de comportamento.** A refatoração é mecânica: mesmo resultado, caminho diferente.
4. Nenhuma ordem real da OKX antes do roteiro de testnet da Fase 7 estar cumprido.
5. A OKX permanece **desabilitada na UI** até a Fase 8. Não habilitar antes.

---

## FASE 1 — INTERFACE `ExchangeClient`

Definir em `src/exchange/exchange-client.interface.ts` o contrato que hoje está implícito no `bybit-client.service.ts` (1109 linhas, 20 métodos públicos):

```
createOrder, cancelOrder, cancelAllOrders, getOpenOrders, getOrderInfo, getOrderHistory,
createStopLossOrder, setTradingStop, clearTradingStop,
getPositions, detectPositionMode, getPositionIdx, waitForPosition,
setLeverage, setMarginMode,
getWalletBalance, getCurrentPrice, getLastTradePrice, getSymbolRules, getServerTime
```

1. Tipos **neutros** de entrada e saída — nada de `positionIdx` (conceito Bybit) ou `algoType` (conceito Binance) vazando na interface. Cada implementação traduz do seu jargão para o neutro.
2. `ExchangeClientFactory` que devolve a implementação a partir do `Exchange` + credenciais + região.
3. A interface recebe **desde já** um `AccountContext` com `{ credentials, mode: DEMO|REAL, region }` — é o que absorve `x-site-id`, `x-simulated-trading` e domínio regional sem espalhar condicionais.
4. Nenhum consumidor muda ainda. Fase de definição.

## FASE 2 — ADAPTAR BINANCE E BYBIT À INTERFACE

Refatoração mecânica, **zero mudança de comportamento**:

1. `BybitClientService` passa a implementar `ExchangeClient` (majoritariamente renomear e ajustar assinaturas).
2. Extrair o código Binance — hoje espalhado em chamadas HTTP diretas dentro de `webhook.service.ts` e outros — para um `BinanceClientService` que implementa a mesma interface.
3. Substituir as ~120 condicionais por `const client = this.exchangeFactory.get(ctx)` seguido da chamada ao método. **Arquivo por arquivo, um commit cada**, começando pelos menores (`trades.controller` 7, `position-sync` 14) e terminando no `webhook.service` (29).
4. Após cada arquivo: `npm run build` + suíte completa. Qualquer teste vermelho interrompe e é corrigido antes de seguir.
5. Ao final, buscar por `Exchange.BYBIT` e `Exchange.BINANCE` fora de `src/exchange/` — o resultado deve ser **próximo de zero**. Adicionar teste-guarda que falha se novas condicionais de corretora aparecerem fora da camada de exchange (mesmo padrão do guarda de `toFixed(` que já funciona).

## FASE 3 — CREDENCIAIS COM PASSPHRASE E REGIÃO

1. `portfolio.entity.ts`: colunas aditivas nullable `apiPassphrase` (criptografada, `select: false`) e `region` (`null`, `EL_SALVADOR`, `EEA`, `US`, `BRA_BTL`, `ARG_BTL`).
2. `CredentialsResolver` passa a devolver `passphrase` e `region` no `AccountContext`.
3. **Unificar com o GAP B da auditoria**: `region` substitui a env global `BYBIT_SITE_ID`, com precedência **portfólio → env → nenhum**. Resolve Bybit e OKX com um mecanismo só.
4. UI do portfólio: campo **Passphrase** (visível só para OKX) e select **Entidade/Região** (opções conforme a corretora).
5. Testes: portfólio OKX sem passphrase → erro de validação claro; Bybit com `region` → header `x-site-id`; sem região → comportamento atual idêntico.

## FASE 4 — TRAVA DE MODO DEMO/REAL ⚠️

Fase curta e a mais importante do plano. Isolada de propósito.

1. **Um único ponto** no `OkxClientService` monta os headers. O `x-simulated-trading: 1` é derivado do `AccountContext.mode`, nunca passado por parâmetro solto.
2. Guarda em tempo de execução: antes de **toda** requisição privada, verificar que `mode === 'DEMO'` implica header presente e `mode === 'REAL'` implica header ausente. Divergência → **lançar exceção e abortar**, jamais enviar.
3. No boot e a cada criação de ordem, logar `[OKX] mode=DEMO simulated=1` (ou `REAL`).
4. Teste dedicado: chamada com `mode: DEMO` **sem** o header → exceção; ordem com `mode: REAL` → header ausente; nenhum caminho envia ordem com modo indefinido.
5. Bloquear a criação de portfólio OKX `REAL` enquanto a flag de release da Fase 8 não estiver ligada.

## FASE 5 — `OkxClientService`

Implementar `ExchangeClient` para OKX (`category: SWAP`, contratos perpétuos USDT):

1. Assinatura HMAC-SHA256 **Base64** sobre `timestamp + method + requestPath + body`, timestamp **ISO 8601 UTC**.
2. Headers: `OK-ACCESS-KEY`, `OK-ACCESS-SIGN`, `OK-ACCESS-TIMESTAMP`, `OK-ACCESS-PASSPHRASE` + `x-simulated-trading` quando DEMO.
3. Domínio a partir de `AccountContext.region`.
4. Mapear o vocabulário OKX para o neutro: `instId` (ex.: `SUI-USDT-SWAP`) ↔ símbolo interno (`SUIUSDT`), `posSide`, `tdMode` (`isolated`/`cross`), `ordType`, `sz` em **contratos** (não em moeda — atenção ao `ctVal` do instrumento).
5. `getSymbolRules` a partir de `/api/v5/public/instruments`: `lotSz` (step), `minSz`, `tickSz`, `ctVal`, `ctMult`. Devolver no mesmo formato já usado por `SymbolRulesService` — **a conversão contratos ↔ quantidade é responsabilidade do client**, nunca do chamador.
6. SL/TP via ordens algo (`/api/v5/trade/order-algo`), respeitando o contrato da interface.
7. Tratamento de erro traduzindo os códigos OKX para as mensagens já usadas (saldo insuficiente, precisão, reduceOnly, would-immediately-trigger).

## FASE 6 — INTEGRAÇÃO COM O QUE JÁ EXISTE

Garantir que a OKX herda tudo que foi corrigido nos planos anteriores, **sem código novo duplicado**:

1. `planTakeProfits` — fatias múltiplas do `lotSz`, soma exata, `minNotional` real da OKX.
2. `exchange-precision.util` — nenhum `toFixed()`; o teste-guarda já cobre.
3. Preço base de SL/TP pelo **fill real** + reposicionamento quando diverge (`protection-reprice`).
4. PnL lido da corretora via `fetchOrderFill` — adicionar `mapOkxFill` ao `fill.util.ts`, ao lado dos mapeadores existentes.
5. `position-sync`, auditor (`SL_PERCENT_MISMATCH`, `MISSING_TP_ORDERS`, `DUPLICATE_POSITION`) e reset funcionando para OKX.
6. Buffer: ordem LIMIT com offset, sem expiração por tempo — mesma semântica das outras.

## FASE 7 — TESTES E VALIDAÇÃO EM DEMO (obrigatória)

1. Testes unitários: assinatura OKX contra um vetor conhecido da documentação; conversão símbolo ↔ `instId`; quantidade ↔ contratos com `ctVal`; trava de modo; `planTakeProfits` com `lotSz` da OKX.
2. **Roteiro manual em conta demo OKX**, com evidência de cada item:
   - [ ] Conexão e saldo
   - [ ] Ordem MARKET: SL e TP criados sobre o **fill real**
   - [ ] Ordem LIMIT com buffer: preenche e a proteção nasce alinhada ao fill
   - [ ] Buffer preenchendo muito depois → SL **reposicionado** (`[SL REPRICE]` no log)
   - [ ] TP1/TP2/TP3 parciais somando exatamente a posição, sem resíduo
   - [ ] SL disparando com o percentual configurado (±tick)
   - [ ] PnL do card idêntico ao da OKX
   - [ ] Sinal contrário cancelando a ordem com buffer
   - [ ] Reinício do processo com ordem pendente → proteção criada no fill
   - [ ] Auditoria sem issues nos trades novos
3. `npm run build` + suíte verde.

## FASE 8 — HABILITAR NA UI

1. Remover o "(em breve)" **apenas da OKX**. BingX continua desabilitada — a interface já estará pronta para recebê-la depois.
2. Flag de release (`OKX_ENABLED`) permitindo desligar sem redeploy de código.
3. Liberar portfólio OKX `REAL` só após o roteiro da Fase 7 cumprido.
4. Documentar em `README` como criar a API Key na OKX (com passphrase) e como escolher a entidade El Salvador.

---

## O CUSTO, COM HONESTIDADE

Isto **não é uma tarefa de algumas horas**. A Fase 2 sozinha toca 12 arquivos e ~120 pontos. A estimativa realista:

| Bloco | Esforço |
|---|---|
| Fase 1 — interface | 4–6 h |
| **Fase 2 — refatorar Binance/Bybit** | **16–24 h** |
| Fase 3 — credenciais e região | 4–6 h |
| Fase 4 — trava de modo | 3–4 h |
| Fase 5 — OkxClient | 14–20 h |
| Fase 6 — integração | 6–10 h |
| Fase 7 — testes + demo | 10–14 h |
| Fase 8 — habilitar | 2–3 h |
| **Total** | **~60–85 h** |

A Fase 2 é o grosso — mas é ela que faz a **próxima** corretora custar ~20h em vez de ~60h, e que impede a manutenção de multiplicar por quatro. Sem ela, a integração da OKX é mais barata agora e muito mais cara para sempre.

**Sugestão de faturamento:** cobrar a Fase 2 como refatoração de arquitetura (beneficia o sistema inteiro, não só a OKX) e as Fases 3-8 como a integração em si.

---

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_INTEGRACAO_OKX.md na raiz e execute as FASES 1 a 8, uma por commit
(a FASE 2 deve ser um commit POR ARQUIVO refatorado). EXECUTE TODAS ATÉ O FIM.

OBJETIVO: habilitar OKX El Salvador de verdade. Hoje ela aparece "(em breve)"
porque o enum Exchange já tem OKX mas não existe nenhum client de execução.

DECISÃO DE ARQUITETURA JÁ TOMADA: extrair a interface ExchangeClient ANTES de
implementar a OKX. O bot tem ~120 condicionais Exchange.BYBIT/Exchange.BINANCE
espalhadas por 12+ arquivos (webhook 29, take-profit 22, stop-loss 19,
position-sync 14, trades.controller 7). Adicionar uma terceira corretora nesse
modelo viraria um switch de 4 em cada ponto — foi esse padrão de lógica duplicada
por corretora que gerou a família de erros do toFixed().

ESCOPO: SOMENTE OKX. BingX continua desabilitada na UI.

O QUE A OKX EXIGE E O BOT NÃO TEM (pesquisado na doc oficial v5):
1. TERCEIRA CREDENCIAL: headers OK-ACCESS-KEY, OK-ACCESS-SIGN, OK-ACCESS-TIMESTAMP
   e OK-ACCESS-PASSPHRASE. O Portfolio só tem apiKey e apiSecret — falta a
   passphrase criptografada.
2. ASSINATURA DIFERENTE: HMAC-SHA256 em BASE64 sobre (timestamp + method +
   requestPath + body), timestamp em ISO 8601 UTC. Nada do que existe hoje serve.
3. DEMO É HEADER, NÃO DOMÍNIO — O RISCO MAIS ALTO DO PROJETO: demo usa o MESMO
   www.okx.com, diferenciado só por "x-simulated-trading: 1". A doc é explícita:
   SEM esse header a requisição autenticada vai para a CONTA REAL. Um erro de
   mapeamento em um único ponto manda ordem com dinheiro real achando que é demo.
4. DOMÍNIO POR REGIÃO: eea.okx.com (EU), us.okx.com (US/AU), okx.com (global).
   "Conta El Salvador" é o mesmo padrão da Bybit Brasil: conta offshore para
   acessar derivativos não oferecidos no BR.

REGRAS CRÍTICAS:
- BINANCE E BYBIT NÃO PODEM MUDAR DE COMPORTAMENTO. A FASE 2 é refatoração
  mecânica: mesmo resultado, caminho diferente. Suíte completa verde após CADA
  arquivo refatorado; teste vermelho interrompe e é corrigido antes de seguir.
- A interface recebe um AccountContext { credentials, mode, region } desde a
  FASE 1 — é ele que absorve x-site-id, x-simulated-trading e domínio regional
  sem espalhar condicionais. Na FASE 3, region SUBSTITUI a env global
  BYBIT_SITE_ID (precedência portfólio -> env -> nenhum), resolvendo de uma vez
  o GAP B da AUDITORIA_E_FECHAMENTO.md.
- FASE 4 (trava de modo): UM ÚNICO ponto monta os headers; guarda em runtime
  verifica que DEMO implica header presente e REAL implica header ausente;
  divergência LANÇA EXCEÇÃO e aborta, nunca envia. Teste dedicado obrigatório.
- Tipos da interface são NEUTROS: nada de positionIdx (Bybit) ou algoType
  (Binance) vazando. Cada client traduz do seu jargão.
- Na OKX, sz é em CONTRATOS, não em moeda. A conversão usando ctVal/ctMult é
  responsabilidade do client, NUNCA do chamador.
- A OKX herda tudo que já foi corrigido, sem duplicar código: planTakeProfits,
  exchange-precision.util (nenhum toFixed), preço base pelo fill real +
  reposicionamento, PnL lido da corretora (adicionar mapOkxFill ao fill.util.ts),
  position-sync, auditor e reset.
- OKX permanece DESABILITADA na UI até a FASE 8, atrás da flag OKX_ENABLED.
  Portfólio OKX REAL só depois do roteiro de demo da FASE 7.
- Ao final da FASE 2, adicionar teste-guarda que falha se novas condicionais de
  corretora aparecerem fora de src/exchange/ (mesmo padrão do guarda de toFixed).

npm run build limpo e >= 320 testes verdes ao final de cada fase.
Sem comentários em código. Liste mudanças por arquivo e o que cada teste cobre.
```

---

**Fontes consultadas:**
- [OKX API guide v5](https://www.okx.com/docs-v5/en/)
- [What's the El Salvador account for Brazilian users?](https://www.okx.com/en-us/help/whats-the-global-trading-account-for-br-users)
- [How do I set up the El Salvador account?](https://www.okx.com/en-br/help/how-do-i-set-up-the-global-trading-account)
- [OKX API FAQ](https://www.okx.com/en-us/help/api-faq)
