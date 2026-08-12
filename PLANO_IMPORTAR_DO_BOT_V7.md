# PLANO_IMPORTAR_DO_BOT_V7 — Rodar o backtester espelhando a estratégia do bot

Objetivo: eliminar o trabalho manual de copiar parâmetro por parâmetro. Selecionar a estratégia do bot → colar o Pine dela → escolher o timeframe → o sistema importa TODOS os parâmetros de execução, descobre o período pelos sinais registrados, roda o backtest e já abre a validação comparando com as entradas reais do bot.

Dois repositórios: ETAPA A no `Trading-Bot` (somente leitura, zero mudança em execução), ETAPAS B–E no `singularity`. Este arquivo existe na raiz dos dois.

## REGRAS

1. Sem comentários em código. Build + testes verdes ao final de cada etapa.
2. **Trading-Bot: nada de execução muda.** Só um endpoint GET novo. Não expor apiKey/apiSecret.
3. **Não regredir nada** no singularity: parciais por TP, RMA/ta.atr, paridade otimizador×clique, sessões congeladas, filtros ADX/RSI/HTF, pegazus_ftr, intrabar, auditoria automática, comparador TradingView, validação webhook×backtester (V6) e o certificado.
4. Todo fluxo novo é ADITIVO: as abas "Parâmetros" e "Add Estratégia" e o botão "Validar Estratégia" continuam funcionando exatamente como hoje.

---

## O QUE JÁ EXISTE (não reconstruir)

- `src/lib/mirror-config.js` — `buildMirroredExecConfig(botStrategy)`, `buildMirroredConfig(...)`, `buildConfigDiff(...)`. O mapeamento bot→backtester JÁ EXISTE, mas hoje só é usado para DIFF na validação, não para pré-preencher e rodar.
- `src/lib/bot-validate.js` — `fetchBotStrategies`, `fetchBotSignals`, `saveValidationReport`, `fetchValidationReports`.
- `src/lib/signal-validate.js` + painel "Validar Estratégia" no TradeLog (V6) — pareamento webhook×backtester, veredito, certificado.
- Backend: `signal_log` + `GET /api/signals`, `GET /api/strategies`, `validation_report`.

## DEFEITOS CONFIRMADOS EM `mirror-config.js` (corrigir na ETAPA B)

1. **`defaultQuantity` é quantidade no ATIVO BASE**, não USD (o bot usa `quantity = strategy.defaultQuantity || 0.002` direto na ordem). Hoje vira `entrySize: 'fixed_usd', entryValue: 0.002` → $0,002. Resolver com o novo modo de entrada (ETAPA B1).
2. **`enableTakeProfit1/2/3` é ignorado** — um TP com percentual preenchido mas DESATIVADO no bot entra no backtest. Filtrar por `enableTakeProfitN`.
3. **`exchange` não é mapeado** (o bot tem `strategy.exchange`) → o backtest pode buscar candles na corretora errada.
4. **`bufferEntry`/`bufferPercentage` não são mapeados** → ordem limit do bot vira market no backtest (muda taxa maker/taker e o preço de entrada).
5. **`symbol`**: `${asset}USDT` está correto (o bot faz o mesmo em `strategies.controller.ts`), mas precisa ser defensivo: se `asset` já terminar em USDT, não duplicar.

---

## ETAPA A — BOT: PERÍODO DOS SINAIS (somente leitura)

`backend/src/webhook/signal-log.controller.ts` + `signal-log.service.ts`:

1. Novo endpoint `GET /api/signals/range?strategyId=...` → `{ first: ISO|null, last: ISO|null, count: number, symbols: string[] }` (min/max de `receivedAt` + contagem + símbolos distintos daquela estratégia). Query agregada (`MIN`, `MAX`, `COUNT`), não carregar linhas.
2. Sem alteração em nenhum outro arquivo. Mesmo guard/throttle dos endpoints existentes.
3. Teste: estratégia sem sinais → `{ first: null, last: null, count: 0, symbols: [] }`; com sinais → limites corretos.

---

## ETAPA B — SINGULARITY: MODO DE ENTRADA "QUANTIDADE FIXA" (engine)

Decisão do cliente: implementar de verdade, para o PnL ficar comparável.

1. `src/lib/engine/backtest-engine.js` — `buildPosition`: suportar `strategy.entrySize === 'fixed_qty'`, onde `strategy.entryValue` é a quantidade no ativo base:
   - `notional = entryValue * entryPrice`; `sizeUsd = notional / leverage` (mantendo a semântica atual em que `sizeUsd` é a margem e o nocional é `sizeUsd * leverage`).
   - Rejeitar a entrada se `sizeUsd > balance` em margem isolada (mesma regra atual) e registrar warning.
   - Todo o resto (TPs, SL, liquidação, parciais, taxas) permanece intocado — só a origem do `sizeUsd` muda.
2. `src/lib/engine/optimizer-core.js`: `fixed_qty` é sempre FIXO da config, nunca dimensão de otimização (o otimizador continua usando `pct_balance` como hoje).
3. UI `ManualParams.jsx`: terceira opção no seletor de entrada — "Quantidade fixa (ativo base)".
4. `BacktestParams.jsx`/relatórios: exibir "ENTRADA: 0.002 DOGE (quantidade fixa)".
5. Testes `fixed-qty.test.js` (derivados à mão): nocional = qtd × preço de entrada; margem = nocional/alavancagem; PnL de um trade LONG com qtd fixa; rejeição por saldo insuficiente em isolada; paridade otimizador×manual inalterada; **todos os testes existentes continuam verdes** (nenhum usa `fixed_qty`).

---

## ETAPA C — SINGULARITY: ESPELHAMENTO CORRETO

`src/lib/mirror-config.js`:

1. `buildMirroredExecConfig` corrigido:
   - `symbol`: `asset` já com USDT → usa como está; senão `${asset}USDT` (maiúsculas).
   - `exchange`: `String(botStrategy.exchange || 'bybit').toLowerCase()`.
   - TPs: incluir apenas os com `enableTakeProfitN === true` **e** percentual > 0; tamanhos de `takeProfitQuantityN`; se a soma ≠ 100, manter como está e registrar aviso (o engine já suporta resíduo).
   - Entrada: `useAccountPercentage` → `{ entrySize: 'pct_balance', entryValue: accountPercentage }`; senão → `{ entrySize: 'fixed_qty', entryValue: defaultQuantity }` (novo modo da ETAPA B).
   - Buffer: `bufferEntry` → `buffer: Number(bufferPercentage) || 0`; senão `buffer: 0`.
   - Manter o que já está certo: leverage, margin, sl, hedge, allowAveraging, direction, breakeven (`moveSLToBreakeven`), breakgain (`breakAgain`).
2. `buildMirroredConfig(savedStrategyOrParsed, botStrategy, { timeframe, period, customFrom, customTo, initialBalance })`: aceitar tanto uma estratégia salva quanto um resultado direto de `parsePineScript` (para o Pine colado na hora); repassar `exchange`, `buffer`, `initialBalance` (default 1000) e o período custom.
3. `buildConfigDiff`: acrescentar linhas de Exchange, Buffer, TPs (lista) e Entrada; atualizar `nonMirrorable` — remover a menção a quantidade fixa (agora é espelhável) e manter Timeframe e Banca inicial.
4. Testes `mirror-config.test.js`: fixture de estratégia do bot com TP2 desativado → só TP1 e TP3 no config; `defaultQuantity` → `fixed_qty`; `useAccountPercentage` → `pct_balance`; buffer ligado/desligado; exchange bybit/binance; asset "DOGE" e "DOGEUSDT" → mesmo símbolo.

---

## ETAPA D — SINGULARITY: ABA "IMPORTAR DO BOT"

Nova aba no painel direito (`Workspace.jsx` → `RightPanel`), ao lado de "Parâmetros" e "Add Estratégia": **"Do Bot"** (ícone Bot). Novo componente `src/components/manual/BotImportPanel.jsx`.

Fluxo na tela, de cima para baixo:

1. **Estratégia do bot** — select alimentado por `fetchBotStrategies()`. Ao escolher:
   - Chama `GET /api/signals/range` e mostra "N sinais registrados · de DD/MM a DD/MM".
   - Renderiza os parâmetros importados em cartão somente-leitura (símbolo, exchange, alavancagem, margem, direção, SL, TPs ativos, entrada, buffer, hedge, averaging, breakeven/breakgain) com um botão "editar" que libera ajuste manual antes de rodar (o ajuste é local, nunca escreve no bot).
2. **PineScript** — textarea + botão "ANALISAR PINESCRIPT" (reusar `parsePineScript`, exatamente como no `AddStrategyPanel`, incluindo parâmetros editáveis, filtros ADX/RSI e bloco HTF quando detectados).
3. **Timeframe do gráfico** — seletor obrigatório (1m…1d) com aviso "é o timeframe do gráfico do TradingView onde o alerta foi criado". Persistir por estratégia do bot em `localStorage` (`botbind_<botStrategyId>`) junto com o Pine e o nome, para a próxima vez vir preenchido.
4. **Período** — default automático pelo range dos sinais (primeiro→último), exibido como "CUSTOM DD/MM–DD/MM"; permitir sobrescrever.
5. **Banca inicial** — campo editável, default $1000.
6. Botão **"RODAR E VALIDAR"**:
   - Monta o config com `buildMirroredConfig` (params do bot + Pine parseado + timeframe + período + banca).
   - Chama `onRunBacktest(config)` — o MESMO caminho do backtest manual (nada de fluxo paralelo; toda a maquinaria de warm-up, intrabar, auditoria automática e sessão continua valendo).
   - Ao terminar, dispara automaticamente a validação já existente do V6 com `botStrategyId` pré-selecionado, e leva o usuário para a aba "Log de Operações" com o painel de validação aberto.
7. Estados de erro claros: sem `VITE_API_URL`, backend offline, nenhuma estratégia no bot, zero sinais no período (com dica "o log de sinais só grava a partir do deploy da Etapa A do V6").

Plumbing mínimo: `Workspace.jsx` passa `onRunBacktest` para a nova aba (já existe) e expõe um `requestValidation(botStrategyId)` que o `BottomPanel`/`TradeLog` consome para abrir o painel de validação — usar o mesmo padrão de registro por ref já usado no `onRegisterUltimateRunner`, sem alterar as assinaturas existentes.

---

## ETAPA E — REGRESSÃO E ACEITE

1. `npm run build` + `npx vitest run` verdes nos dois repos (suítes anteriores intactas).
2. Roteiro de aceite:
   - [ ] Aba "Do Bot" lista as estratégias do bot e mostra período/contagem de sinais.
   - [ ] Parâmetros importados batem com a tela do bot (conferir um a um na primeira vez): TP desativado NÃO aparece; buffer e exchange corretos; entrada em quantidade fixa quando o bot usa `defaultQuantity`.
   - [ ] Colar o Pine + escolher TF + RODAR E VALIDAR → backtest roda e a validação abre sozinha com o veredito.
   - [ ] Reabrir a aba → estratégia, Pine e timeframe já vêm preenchidos.
   - [ ] Backtest manual pela aba "Parâmetros" e o botão "Validar Estratégia" continuam funcionando como antes.
   - [ ] Modo quantidade fixa: nocional = qtd × preço, conferido em 1 trade no log.

---

## PROMPTS PARA O CLAUDE CODE CLI

```
# Sessão 1 — repo Trading-Bot
Leia PLANO_IMPORTAR_DO_BOT_V7.md na raiz e execute a ETAPA A.
REGRA CRÍTICA: nenhuma lógica de execução/ordem pode ser tocada — apenas um
endpoint GET agregado novo em signal-log. npm run build + testes; liste mudanças.

# Sessão 2 — repo singularity
Leia PLANO_IMPORTAR_DO_BOT_V7.md na raiz e execute as ETAPAS B, C, D e E, uma
por commit. Tudo aditivo: não alterar o comportamento das abas "Parâmetros" e
"Add Estratégia" nem do botão "Validar Estratégia". Sem comentários em código;
esperados de teste derivados à mão; npm run build && npx vitest run verdes ao
final de CADA etapa. Ao final liste mudanças por arquivo e o que cada teste cobre.
```

Ordem: A → B → C → D → E. B toca o engine (commit isolado, rodar a suíte inteira antes de seguir).
