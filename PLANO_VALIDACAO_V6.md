# PLANO_VALIDACAO_V6 — Validação automática de estratégia (webhook × backtester)

Objetivo: eliminar testes manuais de entrada. Cada trade do bot nasce de um alerta do TradingView (webhook) — logo, o banco do bot é o registro dos sinais REAIS do Pine. A validação cruza esses sinais com os sinais do backtester para o mesmo período/config e emite um certificado por estratégia.

Dois repositórios: ETAPA A no `Trading-Bot` (mínima e segura — só log e leitura, zero mudança em execução), ETAPA B no `singularity`. Este arquivo existe na raiz dos dois.

## REGRAS

1. Sem comentários em código. Builds e testes verdes por etapa.
2. Trading-Bot: NENHUMA lógica de execução/ordem pode mudar. O log de sinais é append-only, envolvido em try/catch — falha de log JAMAIS bloqueia ou atrasa o webhook. Não expor apiKey/apiSecret em nenhum endpoint novo.
3. singularity: não regredir nada (parciais, RMA, paridade, sessões, HTF, tv-compare V5).

---

## PRÉ-REQUISITO VERIFICADO

O bot HOJE não persiste sinais recebidos-e-ignorados (pausado, posição aberta, averaging off) — só cria Trade quando executa. Sem isso a comparação teria buracos falsos. A ETAPA A resolve.

---

## ETAPA A — TRADING-BOT: LOG DE SINAIS + LEITURA (executar no repo Trading-Bot)

### A1. Entity `signal_log`
`backend/src/webhook/signal-log.entity.ts`: `id (uuid)`, `strategyId`, `symbol` (normalizado), `action` ('BUY'|'SELL'), `receivedAt` (timestamptz, default now), `payload` (jsonb, corpo bruto do webhook), `decision` (varchar: 'executed' | 'skipped_paused' | 'skipped_position_open' | 'skipped_single_mode' | 'skipped_new_orders_paused' | 'error'), `decisionReason` (text, nullable), `tradeId` (nullable). Index em (strategyId, receivedAt). Registrar no módulo/TypeORM (synchronize já usado no projeto — conferir padrão das entities existentes e seguir).

### A2. Gravação no webhook (sem tocar na lógica)
`webhook.service.ts`: na PRIMEIRA linha do processamento do sinal (após parse/validação do payload, antes de qualquer decisão), inserir o registro com `decision: 'error'` provisório dentro de `try/catch` silencioso; nos pontos de retorno existentes (skips, execução, erro), ATUALIZAR o registro com a decision correspondente e `tradeId` quando houver — sempre em try/catch, nunca `await` bloqueante no caminho crítico (usar `.catch(() => {})` ou fila em memória). Nenhum `return`/fluxo existente é alterado.

### A3. Endpoints de leitura
- `GET /api/signals?strategyId&from&to&limit` → lista do signal_log (max 2000, ordenado por receivedAt).
- Conferir `GET /api/strategies` (já existe): garantir que retorna a config de execução completa da estratégia (TP/SL, leverage, margin, hedgeMode, allowAveraging, direction, symbol, timeframe se existir) SEM apiKey/apiSecret. Complementar campos faltantes no select se necessário.
- `POST /api/validation-reports` + `GET /api/validation-reports?strategyId` com entity `validation_report` (`id, strategyId, report (jsonb), configHash, engineVersion, createdAt`) — persistência do certificado.
- Rate-limit padrão do app; `@SkipThrottle()` NÃO se aplica aqui.

### A4. Testes (jest)
Webhook com log mockado falhando → fluxo de execução intacto (retornos idênticos); decisions gravadas por caminho (executed, skipped_position_open, skipped_paused); endpoint signals filtra por período; strategies não vaza segredos.

---

## ETAPA B — SINGULARITY: FLUXO DE VALIDAÇÃO + CERTIFICADO (executar no repo singularity)

### B1. Cliente de dados — `src/lib/bot-validate.js`
`fetchBotSignals(strategyId, from, to)`, `fetchBotStrategies()` (reusar auditor-api), `saveValidationReport(...)`, `fetchValidationReports(strategyId)` — todos via `VITE_API_URL`, com os mesmos headers/token do ai-chat quando configurado.

### B2. Comparador — `src/lib/signal-validate.js`
`compareBotSignals({ backtestSignals, candles, tfMs, botSignals })`:
1. Mapear cada webhook para o candle do SINAL: `candleOf(receivedAt)` = floor(receivedAt/tfMs); se `receivedAt` está nos primeiros 90s de um candle, atribuir ao candle ANTERIOR (alerta de fechamento chega logo após o close). Registrar `arrivalDelayMs` = receivedAt − close do candle atribuído.
2. Parear por candle + lado com os sinais do backtester (TODOS os webhooks contam, inclusive skipped — a decisão do bot não importa para validar o Pine).
3. Saída: `{ pairedPct, paired[], onlyBot[], onlyBacktest[], avgArrivalDelayMs, entryDeviation: { avgPct, maxPct, breakdown: [{candle, botFill, backtestOpen, delayMs, deviationPct}] } }` — entryDeviation calculado só nos webhooks `executed` com trade vinculado (fill real vs open do candle seguinte no backtester).
4. Veredito: `validada` se `pairedPct >= 95` e `onlyBot`/`onlyBacktest` vazios ou todos explicados (ex.: candle fora da janela de dados); senão `divergente` com a lista de candles a investigar.

### B3. Backtest espelhado
No fluxo de validação, o backtest roda com: params do indicador da ESTRATÉGIA SALVA do singularity (o Pine vive aqui) + config de EXECUÇÃO importada da estratégia do bot (TP/SL, leverage, margin, hedge, averaging, direction, symbol, timeframe). Período default: primeiro→último sinal do signal_log (mais warm-up). Mostrar diff lado a lado "config bot × config aplicada" antes de rodar; campos não espelháveis listados com aviso.

### B4. UI — painel "Validar Estratégia"
Evoluir o atual "vs Bot" no `TradeLog.jsx` (ou nova aba no BottomPanel se ficar grande):
1. Passos: selecionar estratégia salva do singularity → selecionar estratégia do bot (portfólio) → período (default automático) → VALIDAR.
2. Resultado: veredito grande (✓ VALIDADA / ✗ DIVERGENTE), pairedPct, atraso médio do webhook, desvio médio de entrada com breakdown (delay × slippage), lista de candles divergentes clicável (foca no gráfico), diff de config.
3. Botão "Explicar com IA" (mode auditor) com todos os números no contexto; botão "Salvar certificado".
4. Vínculo persistente: gravar `botStrategyId` na Strategy salva do singularity após a primeira validação (pré-seleciona da próxima vez).

### B5. Certificado
Objeto: `{ strategyName, botStrategyId, symbol, timeframe, period, pairedPct, verdict, avgArrivalDelayMs, entryDeviation, configDiff, configHash, engineVersion, createdAt }`.
- `configHash` = sha256 de (pinescript + params canônicos + filtros + config de execução espelhada). `engineVersion` = version do package.json.
- Persistir via `POST /api/validation-reports`; fallback localStorage se backend offline.
- Badge no seletor de estratégias (`ManualParams`/`AddStrategyPanel`): "✓ Validada DD/MM" enquanto o configHash atual bater com o do certificado; se params/pine/config mudarem → "⟳ Revalidação recomendada". Download do certificado em .txt no padrão dos relatórios existentes.

### B6. Testes (vitest)
`signal-validate.test.js`: mapeamento webhook→candle (chegada 2s após close → candle anterior; chegada no meio do candle → candle corrente com warning); pareamento com skipped incluídos; órfãos dos dois lados; veredito ≥95%; entryDeviation com breakdown derivado à mão; configHash estável e sensível a mudança de 1 param; certificado inválido após mudança de params.

---

## ETAPA C — ACEITE (manual, com o cliente)

- [ ] Estratégia que operou na subconta: VALIDAR → pairedPct e veredito na tela em <1 min, sem nenhum export manual.
- [ ] Sinais skipped (posição aberta) aparecem pareados normalmente.
- [ ] Desvio de entrada exibido com breakdown (delay/slippage) e explicado pela IA em português simples.
- [ ] Certificado salvo; badge "✓ Validada" no seletor; editar um parâmetro → badge muda para "Revalidação recomendada".
- [ ] Caso de divergência simulada (mudar 1 param no backtest) → veredito DIVERGENTE com candles listados.

## PROMPTS PARA O CLAUDE CODE CLI

```
# Sessão 1 — repo Trading-Bot
Leia PLANO_VALIDACAO_V6.md na raiz e execute a ETAPA A completa.
REGRA CRÍTICA: nenhuma lógica de execução muda; log em try/catch nunca
bloqueia o webhook. npm run build + testes ao final; liste mudanças por arquivo.

# Sessão 2 — repo singularity
Leia PLANO_VALIDACAO_V6.md na raiz e execute a ETAPA B completa (B1→B6).
npm run build && npx vitest run ao final; liste mudanças por arquivo.
```

Ordem: A → B → C. A ETAPA B só funciona de ponta a ponta com a A deployada, mas pode ser desenvolvida em paralelo com os endpoints mockados nos testes.
