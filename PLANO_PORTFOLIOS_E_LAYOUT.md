# PLANO_PORTFOLIOS_E_LAYOUT — Portfólios, novo layout e reset dos dados de teste

Baseado no protótipo `https://snxnovovisualv2.base44.app/`, analisado página a página, comparado com o código atual.

---

## 1. AS DIFERENÇAS (levantadas do protótipo)

### 1.1 Navegação

| Protótipo | Bot hoje |
|---|---|
| Dashboard | ✓ |
| **Desempenho** | **faltando** |
| **Portfólios** | **faltando** |
| Estratégias | ✓ |
| Auditor | ✓ |
| **Avisos** | **faltando** |
| AI Chat | ✓ |
| Logs | ✓ |
| Configurações | ✓ |

### 1.2 Mudança arquitetural central

O protótipo move as credenciais **da estratégia para o portfólio**:

**Hoje** — `strategy.entity.ts` carrega `exchange`, `isTestnet`, `isRealAccount`, `apiKey`, `apiSecret`. Cada estratégia é uma ilha com credenciais próprias.

**Protótipo** — um `Portfolio` tem `nome`, `corretora`, `modo` e as credenciais. A estratégia apenas **aponta** para um portfólio. No formulário de estratégia do protótipo **não existe mais campo de API Key**; o segundo campo é `Portfólio: [Selecione um portfólio]`, exibido como `teste · BYBIT · DEMO`.

Isso é o que permite tudo o resto: agrupar operações, filtrar o dashboard e medir desempenho por conta.

**Raio de impacto:** 10 arquivos leem `strategy.apiKey` / `strategy.apiSecret` (38 ocorrências) — `webhook`, `position-sync`, `take-profit`, `stop-loss`, `auditor`, `trades.controller`, `binance-ws` (2), `strategies.service`, `app.controller`. **Nenhum pode quebrar.**

### 1.3 Modelo do Portfólio (do modal "Novo Portfólio")

| Campo | Valores |
|---|---|
| Nome do Portfólio | texto livre (ex.: "Subconta Scalping") |
| Corretora | **Bybit, Binance, OKX El Salvador, BingX** |
| Modo | **Demo, Real** |
| API Key | texto |
| Secret Key | texto |

O card do portfólio mostra: nome, corretora, badge de modo (DEMO/REAL), API Key mascarada (`asdad••••••`), status, e ações Editar / Excluir.

> **Atenção:** o protótipo lista OKX e BingX, mas o bot só implementa Binance e Bybit. Este plano cria a estrutura para as quatro e **expõe apenas as duas suportadas** — as outras entram desabilitadas com rótulo "em breve". Implementar OKX/BingX de verdade é outro projeto (cada uma tem API, assinatura e filtros próprios).

### 1.4 Dashboard

- Seletor **"Portfólio: Todos os portfólios"** no topo, filtrando a página inteira
- Cards: `SALDO DA CARTEIRA`, `SALDO DE MARGEM`, `TOTAL EQUITY`, `FLOATING NÃO REALIZADO`
- Painel **"Controles de Emergência"** com contagem de posições e botões `Pausar Todas` / `Fechar Todas`
- Tabela **Posições Abertas** com coluna **PORTFÓLIO** e ação `Fechar`
- **Trades Recentes** com filtros `Todos / OPEN / CLOSED / ERROR` e alternância **Cards / Tabela**
- Cada card de trade exibe **`Portfólio: <nome>`**

### 1.5 Desempenho (página nova)

- Seletor de portfólio
- PnL total do período
- Gráfico de crescimento de capital, alternância **Gráfico / Candles**
- Períodos **7D / 15D / 30D / 90D / Tudo**
- Tabela diária: `DATA | SPOT ($) | FUTURES ($) | TOTAL ($)` com acumulado

### 1.6 Design tokens

| Token | Protótipo | Bot hoje |
|---|---|---|
| `--primary` | `252 100% 65%` | `264 83% 66%` |
| `--success` | `169 100% 50%` | não existe |
| `--warning` | `46 100% 50%` | não existe |
| `--destructive` | `348 100% 55%` | — |
| `--radius` | `.75rem` | `0.625rem` |
| Fonte títulos | **Sora** | Inter |
| Fonte corpo | Inter | Inter |
| Fonte mono | system mono | JetBrains Mono |

O protótipo usa HSL sem `hsl()` no valor (padrão shadcn) e tem **tema claro/escuro** (há um toggle de sol no topo e no rodapé da sidebar).

---

## 2. REGRAS

1. **Só adicionar. Nada do que funciona pode quebrar.**
2. Sem comentários em código.
3. `npm run build` + testes verdes ao final de cada fase (hoje: 31 suites, 203 testes).
4. Todo campo novo é **aditivo e nullable**; `portfolioId` começa nullable com fallback para as credenciais da estratégia.
5. Credenciais **nunca** trafegam em texto puro na resposta da API — sempre mascaradas, como no protótipo. Reusar o `EncryptionUtil` já existente.
6. Reset de dados **jamais** em cron ou automático: só por endpoint manual com `dryRun` padrão.
7. Fases 0 a 3 são backend/infra e podem ir para produção antes do frontend.

---

## FASE 0 — DESIGN TOKENS E SHELL DO LAYOUT (risco zero)

Nenhuma lógica, só aparência. Entregável isolado e reversível.

1. `frontend/app/globals.css`: alinhar os tokens à tabela 1.6 — `--primary: 252 100% 65%`, adicionar `--success` e `--warning`, `--radius: .75rem`. Manter todos os tokens atuais que não têm equivalente, para não quebrar componentes existentes.
2. `layout.tsx`: carregar **Sora** junto de Inter no `<link>` do Google Fonts; aplicar Sora em `h1..h4` e nos números grandes dos cards.
3. Acrescentar ao `NAV_ITEMS` os três itens faltantes — **Desempenho**, **Portfólios**, **Avisos** — apontando para páginas *placeholder* que só exibem o cabeçalho. As rotas passam a existir sem nenhum comportamento novo.
4. Componente `<PageHeader title subtitle rightSlot />` reproduzindo o cabeçalho do protótipo (título, subtítulo e o chip `● Conectado HH:MM:SS` à direita).
5. Toggle de tema claro/escuro, com preferência em `localStorage` e `prefers-color-scheme` como padrão inicial.

## FASE 1 — ENTIDADE E CRUD DE PORTFÓLIO (backend)

1. `src/portfolios/portfolio.entity.ts`:
   - `id` uuid
   - `name` string
   - `exchange` enum (reusar o `Exchange` existente, estendido com `OKX` e `BINGX` **sem implementação de client**)
   - `mode` enum `'DEMO' | 'REAL'`
   - `apiKey`, `apiSecret` — `select: false`, criptografados com `EncryptionUtil` (mesmo padrão da Strategy)
   - `isActive` boolean default `true`
   - `createdAt` / `updatedAt`
2. `PortfoliosModule`, `PortfoliosService`, `PortfoliosController` em `@Controller('portfolios')`: `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`.
3. `findAllPublic()` com `select` explícito **incluindo todos os campos não sensíveis** e devolvendo `apiKeyMasked` (primeiros 5 caracteres + `••••••`). **Nunca** devolver `apiSecret`.
   > Cuidado aprendido no `PLANO_FIX_TPS_DESATIVANDO`: `select` explícito que esquece um campo faz a UI mentir. Cobrir com teste que compara as chaves retornadas com as colunas esperadas.
4. `DELETE` deve **recusar** (409) se houver estratégia vinculada ou trade aberto, com mensagem clara. Nunca apagar em cascata.
5. Endpoint `POST /portfolios/:id/test-connection`: valida as credenciais na corretora e devolve saldo. É o que sustenta o `Status: ativo` do card.
6. Migração criando a tabela.

## FASE 2 — ESTRATÉGIA APONTA PARA O PORTFÓLIO (com fallback)

Esta é a fase de maior risco. A regra é **coexistência**, não substituição.

1. `strategy.entity.ts`: coluna aditiva `portfolioId: string | null` (nullable, default `null`). **Não remover** `apiKey`, `apiSecret`, `exchange`, `isTestnet`, `isRealAccount`.
2. Criar `src/common/credentials-resolver.service.ts` com um único método:
   ```
   resolveCredentials(strategy) → { apiKey, apiSecret, exchange, isTestnet, portfolioId, source }
   ```
   Precedência: **portfólio vinculado** → senão **campos legados da estratégia**. `source` (`'portfolio' | 'strategy'`) entra nos logs.
   - `mode: 'DEMO'` do portfólio mapeia para `isTestnet: true`; `'REAL'` para `isTestnet: false` e `isRealAccount: true`.
3. Substituir as 38 leituras diretas de `strategy.apiKey`/`apiSecret` nos 10 arquivos por chamadas ao resolver. **Uma substituição mecânica, sem mudar mais nada em cada arquivo.**
4. Teste para cada um dos 10 consumidores: com portfólio → usa as credenciais do portfólio; sem portfólio → usa as da estratégia (comportamento atual preservado).
5. `GET /strategies` passa a devolver `portfolioId` e um objeto `portfolio { id, name, exchange, mode }` para o badge do card.

## FASE 3 — MIGRAÇÃO DOS DADOS EXISTENTES

Migração idempotente, executável mais de uma vez sem efeito colateral:

1. Agrupar as estratégias existentes por `(exchange, isTestnet, isRealAccount, apiKey)`.
2. Para cada grupo, criar um portfólio `"<Exchange> <Demo|Real>"` (ex.: `Bybit Demo`) reaproveitando as credenciais já criptografadas — **sem descriptografar**.
3. Preencher `strategy.portfolioId` do grupo.
4. Estratégia sem credenciais fica com `portfolioId = null` e continua funcionando pelo fallback.
5. Rodar em transação, com log da contagem de portfólios criados e estratégias vinculadas.

## FASE 4 — PÁGINA PORTFÓLIOS (frontend)

Reproduzir a tela do protótipo:

1. `frontend/app/portfolios/page.tsx`: contagem `N portfólio(s) cadastrado(s)`, botão `+ Novo Portfólio`, grade de cards.
2. Card: nome, corretora, badge de modo (DEMO em violeta, REAL em vermelho), `API Key: xxxxx••••••`, `Status: ativo`, botões `Editar` / `Excluir`.
3. Modal `Novo Portfólio` com os 5 campos da tabela 1.3. Corretoras não suportadas aparecem **desabilitadas** com sufixo "(em breve)".
4. Na edição, os campos de credencial ficam **vazios**; preenchê-los substitui, deixá-los em branco preserva — mesmo padrão do formulário de estratégia atual.
5. Botão `Testar conexão` chamando o endpoint da Fase 1, exibindo o saldo retornado.
6. `Excluir` mostra o motivo quando o backend recusa (estratégia vinculada / trade aberto).

## FASE 5 — FORMULÁRIO DE ESTRATÉGIA COM PORTFÓLIO

1. Inserir o select **Portfólio** como segundo campo, com as opções no formato `nome · EXCHANGE · MODO`.
2. Ocultar os campos API Key / Secret / Corretora / Testnet **quando houver portfólio selecionado** — eles continuam existindo no payload para as estratégias legadas sem portfólio.
3. Badge do portfólio no card da estratégia, ao lado do nome (como no protótizo).
4. Bloquear a criação de estratégia sem portfólio **quando já existir ao menos um portfólio** cadastrado.
5. Aproveitar para consertar o campo órfão: **remover `bufferExpiryCandles` da UI** — ele não faz mais nada desde a remoção da expiração do buffer, e hoje engana quem configura.

## FASE 6 — DASHBOARD COM FILTRO DE PORTFÓLIO

1. `GET /trades` e os endpoints de posição/saldo aceitam `?portfolioId=` (opcional; ausente = todos).
2. Seletor **"Portfólio: Todos os portfólios"** no topo, com o valor em `localStorage`.
3. Cards de saldo agregados: com um portfólio, os dados daquela conta; com "todos", a soma. **Nunca somar contas DEMO com REAL** — separar visualmente ou somar apenas as REAL, com legenda explícita.
4. Coluna **PORTFÓLIO** na tabela de posições abertas e linha `Portfólio: <nome>` no card de trade.
5. Painel **Controles de Emergência** (`Pausar Todas` / `Fechar Todas`) respeitando o filtro ativo, com **confirmação obrigatória** nomeando o portfólio e a quantidade de posições afetadas.
6. Alternância **Cards / Tabela** e filtros `Todos / OPEN / CLOSED / ERROR`.

## FASE 7 — PÁGINA DESEMPENHO

1. `GET /performance?portfolioId=&period=7d|15d|30d|90d|all` devolvendo a série diária.
2. PnL agregado do período; série acumulada de crescimento de capital.
3. Tabela `DATA | SPOT | FUTURES | TOTAL` com acumulado. (O bot só opera futuros hoje — a coluna SPOT fica zerada e preparada.)
4. Gráfico com alternância Gráfico / Candles e os botões de período.
5. **Excluir do cálculo** os trades com `excludeFromStats = true` (duplicatas e poeira já tratadas no `PLANO_FIX_TRADES_DUPLICADOS`) — sem isso o desempenho nasce inflado.

## FASE 8 — PÁGINA AVISOS

Consolidar o que já existe e hoje fica escondido: issues do auditor, `tpWarnings`, trades em `ERROR`, estratégias pausadas e posições sem proteção. Nenhuma lógica nova — só uma superfície de leitura sobre dados existentes, com filtro por portfólio.

## FASE 9 — RESET DOS DADOS DE TESTE

Destrutivo. Isolado no fim, e manual.

1. `POST /admin/reset-trades?dryRun=true` (padrão `true`), com `portfolioId` opcional:
   - `dryRun` **lista** o que apagaria: contagem por status, período, PnL acumulado
   - sem `dryRun`, exige `confirm: "RESET"` no corpo
2. Apaga `trades`, `trade_executions` e `signal_logs`. **Preserva** estratégias, portfólios, credenciais e configurações.
3. **Recusa executar se houver trade `OPEN`** — apagar o registro de uma posição viva deixaria a posição órfã na corretora. Instruir a fechar ou aguardar antes.
4. Exportar um `.json` de backup no diretório de saída antes de apagar.
5. Registrar em `AuditLog` quem executou, quando e quantos registros foram removidos.
6. Após o reset, zerar contadores derivados (`lastTpLevel`, caches de estatística).

## FASE 10 — TESTES E ACEITE

1. Testes:
   - `credentials-resolver`: com portfólio, sem portfólio, portfólio inativo, credenciais ausentes
   - cada um dos 10 consumidores usando o resolver
   - `findAllPublic` do portfólio não vaza `apiSecret` e devolve todos os campos esperados
   - `DELETE` de portfólio com estratégia vinculada → 409
   - migração da Fase 3 idempotente (rodar duas vezes = mesmo resultado)
   - filtro `portfolioId` em trades e desempenho
   - reset com trade `OPEN` → recusado; `dryRun` não apaga nada
2. `npm run build` + suíte verde (≥ 203 testes).
3. Aceite prático:
   - [ ] Criar portfólio Bybit DEMO, testar conexão, ver o saldo
   - [ ] Criar estratégia vinculada a ele **sem** informar API Key
   - [ ] Webhook nessa estratégia executa usando as credenciais do portfólio (log com `source: portfolio`)
   - [ ] Estratégia antiga **sem** portfólio continua operando normalmente
   - [ ] Dashboard filtra por portfólio; card de trade mostra o nome do portfólio
   - [ ] Desempenho por portfólio bate com o PnL da corretora
   - [ ] Reset em `dryRun` lista corretamente; com trade aberto, recusa
   - [ ] Tema claro e escuro sem quebra visual

---

## ORDEM E RISCO

| Fase | Risco | Observação |
|---|---|---|
| 0 — tokens/layout | baixo | pode ir sozinha para produção |
| 1 — CRUD portfólio | baixo | aditivo, ninguém consome ainda |
| **2 — resolver de credenciais** | **alto** | toca os 10 serviços; o fallback é o que protege |
| 3 — migração | médio | idempotente e em transação |
| 4-8 — frontend | baixo | consomem o que já existe |
| **9 — reset** | **alto** | destrutivo; só com dryRun antes |

Sugestão: parar após a Fase 3, validar em produção por alguns dias com as estratégias legadas rodando, e só então seguir para o frontend.

---

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_PORTFOLIOS_E_LAYOUT.md na raiz e execute as FASES 0 a 10, uma por commit.
PARE após a FASE 3 e me apresente o resultado antes de seguir para o frontend.

CONTEXTO: o protótipo https://snxnovovisualv2.base44.app/ move as credenciais da
ESTRATÉGIA para um PORTFÓLIO. Hoje strategy.entity.ts carrega exchange, isTestnet,
isRealAccount, apiKey e apiSecret, e 10 arquivos leem strategy.apiKey/apiSecret
(38 ocorrências): webhook.service, position-sync.service, take-profit.service,
stop-loss.service, auditor.service, trades.controller, strategies.service,
app.controller, binance-ws/user-data-stream.service e binance-ws/binance-ws-init.service.

MODELO DO PORTFÓLIO (do modal do protótipo): nome, corretora (Bybit, Binance,
OKX El Salvador, BingX), modo (Demo/Real), API Key, Secret Key. O card mostra a
API Key mascarada (asdad••••••) e o status. No formulário de ESTRATÉGIA do
protótipo não existe mais campo de API Key — o segundo campo é o select de
portfólio, exibido como "teste · BYBIT · DEMO".

NAVEGAÇÃO: faltam três itens — Desempenho, Portfólios e Avisos.

TOKENS: --primary 252 100% 65%, --success 169 100% 50%, --warning 46 100% 50%,
--destructive 348 100% 55%, --radius .75rem, Sora para títulos + Inter para corpo,
com tema claro/escuro.

REGRAS CRÍTICAS:
- SÓ ADICIONAR. Nada que funciona pode quebrar. 31 suites / 203 testes precisam
  continuar verdes, e npm run build limpo, ao final de cada fase.
- portfolioId é NULLABLE e a Strategy MANTÉM apiKey/apiSecret/exchange/isTestnet.
  Criar um CredentialsResolver com precedência portfólio -> campos legados da
  estratégia, e substituir as 38 leituras por ele de forma mecânica. Estratégia sem
  portfólio DEVE continuar operando exatamente como hoje.
- Nunca devolver apiSecret pela API; apiKey só mascarada. No select explícito de
  findAllPublic, cobrir com teste que compara as chaves retornadas com as colunas
  esperadas (já tivemos bug de select esquecendo campo e a UI mentindo).
- OKX e BingX entram como enum e aparecem DESABILITADAS na UI ("em breve") — não
  implementar client para elas.
- Não somar saldo de conta DEMO com conta REAL no dashboard.
- Excluir trades com excludeFromStats = true dos cálculos de desempenho.
- O reset da FASE 9 tem dryRun=true por padrão, exige confirm:"RESET", RECUSA se
  houver trade OPEN, exporta backup .json antes, e preserva estratégias, portfólios
  e configurações. Nunca em cron.
- Na FASE 5, remover da UI o campo bufferExpiryCandles (órfão desde a remoção da
  expiração do buffer).

Sem comentários em código. Liste mudanças por arquivo e o que cada teste cobre.
```
