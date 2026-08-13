# PLANO_FIX_BUFFER_EXPIRACAO — Ordem com buffer vive até o fechamento do candle seguinte

Bug comprovado (SUIUSDT, buffer 0,30%, SHORT): sinal com `price = 0.69040` → limite correto em `0.69040 × 1.003 = 0.6924712` (a direção do buffer está certa). O candle seguinte abriu em ~0,6890 e subiu até ~0,6952, cruzando o limite — mas a ordem **já tinha sido cancelada**, porque o monitor só espera `30 tentativas × 10s = 5 minutos` e então cancela ("LIMIT order monitoring timeout - order cancelled to prevent orphan positions").

**Regra nova (decisão do cliente):** a ordem limit com buffer vive até o **fechamento do candle seguinte ao sinal**, configurável em N candles (default 1).

## REGRAS

1. Sem comentários em código. `npm run build` + testes verdes ao final de cada fase.
2. **Compatibilidade obrigatória:** estratégia SEM timeframe configurado mantém EXATAMENTE o comportamento atual (5 min). A regra nova só entra quando houver timeframe — evita mudar silenciosamente o comportamento de estratégias em produção.
3. Não alterar a lógica de cálculo do preço do buffer (está correta) nem o cancelamento por sinal oposto (`[BUFFER CANCEL]`, correto).
4. A proteção contra posição órfã (SL/TP após o fill) continua curta e agressiva — só a espera PELO FILL muda.
5. Nada no `singularity` é tocado nas Fases 1-4. A Fase 5 espelha a regra no backtester.

---

## CAUSA RAIZ (confirmada)

`webhook.service.ts`, duas funções gêmeas (Binance ~1170, Bybit ~1412):

```ts
const maxAttempts = 30;
const delayMs = 10000;          // 30 × 10s = 300s = 5 minutos
for (let attempt = 0; attempt < maxAttempts; attempt++) { ... }
// ao fim, sem fill e sem posição → cancela a ordem + status ERROR
```

O loop tem DOIS papéis misturados: (a) esperar o fill da entrada e (b) criar a proteção depois do fill. O prazo de 5 min é adequado para (b) e completamente inadequado para (a), porque um buffer de 0,30% num gráfico de 1h costuma levar dezenas de minutos para ser atingido.

Agravante: o loop é um `setTimeout` em memória — um restart do Railway mata o monitor e a ordem fica órfã no book. Por isso a expiração precisa ser persistida e verificada pelo cron.

Base já existente e reaproveitável: `position-sync.service.ts` roda `@Cron('*/5 * * * *')` e **já** identifica ordens LIMIT pendentes (mantém o trade aberto quando o status é `New`/`PartiallyFilled`, linhas ~291-304).

---

## FASE 1 — CONFIGURAÇÃO: TIMEFRAME E VALIDADE

1. `strategies/strategy.entity.ts` — colunas aditivas, nullable (migração aditiva, `type` explícito, mesmo padrão de `closeDetail`):
   - `timeframe: string | null` — TF do gráfico do TradingView onde o alerta foi criado (`'1m'|'3m'|'5m'|'15m'|'30m'|'1h'|'2h'|'4h'|'1d'`). Default `null`.
   - `bufferExpiryCandles: number` — default `1`.
2. `webhook/dto/tradingview-signal.dto.ts` — campo opcional `timeframe?: string` (o usuário pode mandar `"timeframe": "{{interval}}"` no JSON do alerta). Quando presente, **tem precedência** sobre o da estratégia; normalizar os formatos do TradingView (`"60"` → `1h`, `"240"` → `4h`, `"D"` → `1d`, `"15"` → `15m`).
3. Frontend do bot: select de timeframe e campo "validade da ordem com buffer (candles)" na tela de edição da estratégia, visíveis apenas quando `bufferEntry` estiver ligado. Aviso ao lado: "sem timeframe, a ordem expira em 5 minutos".
4. Novo util `webhook/buffer-expiry.util.ts`:
   - `TF_MS` (mesma tabela do backtester).
   - `resolveTimeframe(signal, strategy): string | null` — precedência sinal → estratégia → `null`.
   - `computeBufferExpiry(receivedAt: Date, timeframe: string, candles = 1): Date` → `ceil(receivedAt / tfMs) * tfMs + (candles - 1) * tfMs`. Como o webhook chega logo após o fechamento do candle do sinal, o `ceil` cai exatamente no fechamento do candle SEGUINTE.
   - Sem timeframe → retorna `null` (o chamador mantém os 5 min atuais).
5. Testes `buffer-expiry.util.spec.ts` (derivados à mão): sinal recebido 22:00:03 num TF de 1h → expira 23:00:00; recebido 22:59:58 → expira 23:00:00 (borda); `candles = 2` → 00:00:00; TF `15m` recebido 10:16:04 → 10:30:00; normalização `"60"`/`"D"`/`"240"`; sem TF → `null`.

## FASE 2 — PERSISTIR A VALIDADE NO TRADE

1. `strategies/trade.entity.ts` — coluna aditiva nullable: `pendingExpiresAt: Date | null` (timestamptz). É o que permite ao cron cobrar a expiração após um restart.
2. `webhook.service.ts`, no ponto em que a ordem LIMIT com buffer é criada: calcular `computeBufferExpiry(...)` e gravar em `pendingExpiresAt` junto com o trade. Se `null` (sem TF), gravar `null` → comportamento atual.
3. Nenhuma mudança nos parâmetros enviados à corretora. A ordem continua sendo criada exatamente como hoje (GTC).

## FASE 3 — MONITOR: ESPERAR O FILL ATÉ A EXPIRAÇÃO

Nas duas funções (Binance e Bybit), substituir o `for` de 30 tentativas por um laço guiado pelo relógio, mantendo o resto do corpo intacto:

1. `const deadline = trade.pendingExpiresAt ?? (agora + 5 min)` — sem `pendingExpiresAt`, comportamento idêntico ao atual.
2. Enquanto `Date.now() < deadline`: aguarda `delayMs` (10s) e repete a verificação de status já existente. Teto de segurança: se `deadline - agora > 26h`, cortar em 26h (protege contra TF inválido).
3. Ao detectar `Filled` → segue exatamente o fluxo atual de criação de SL/TP (nada muda ali).
4. Ao vencer o `deadline` sem fill:
   - Cancelar a ordem (mesma chamada de hoje) e marcar o trade com `status: 'ERROR'` e mensagem específica: `Ordem com buffer expirou no fechamento do candle seguinte sem ser preenchida` — distinta do timeout de proteção, para você diferenciar no log os dois motivos (hoje os dois caem na mesma frase).
   - Registrar no `signal_log` a decisão correspondente (`skipped_buffer_expired`), para a validação webhook×backtester não contar esse sinal como "só no bot".
5. A criação de proteção após o fill continua com o limite curto atual (30 × 10s) — esse prazo é o correto para (b) e não muda.

## FASE 4 — POSITION-SYNC COMO GARANTIA (sobrevive a restart)

`position-sync/position-sync.service.ts` (cron a cada 5 min), no trecho que já trata `trade.type === 'LIMIT' && trade.exchangeOrderId`:

1. Se o status na corretora for `Filled` e o trade ainda não tiver SL/TP → disparar a mesma rotina de criação de proteção usada pelo webhook (extrair para um método público reutilizável, sem duplicar lógica).
2. Se o status for `New`/`PartiallyFilled` **e** `trade.pendingExpiresAt` já passou → cancelar a ordem e marcar como expirada (mesma mensagem da Fase 3).
3. Se `pendingExpiresAt` for `null` → não faz nada de novo (comportamento atual).
4. Testes: mock de trade pendente expirado → cancela; pendente não expirado → mantém; filled sem proteção → cria; sem `pendingExpiresAt` → intocado.

## FASE 5 — ESPELHAR A REGRA NO BACKTESTER (repo `singularity`)

Hoje o backtester **nunca** expira a ordem pendente (`pendings[side]` só morre com sinal oposto) — o oposto do bot. Alinhar:

1. `src/lib/engine/backtest-engine.js`: novo campo `strategy.bufferExpiryCandles` (default 1). Ao criar `pendings[side]`, gravar `expiresIdx = i + bufferExpiryCandles + 1`. No loop de preenchimento, descartar o pendente quando `i > expiresIdx`, registrando um `warning` do tipo `BUFFER_EXPIRED` para aparecer na auditoria.
2. `src/lib/mirror-config.js`: mapear `bufferExpiryCandles` do bot (defeito #4 do PLANO_IMPORTAR_DO_BOT_V7 já previa o buffer; incluir também a validade).
3. UI (`ManualParams.jsx`): campo "validade da ordem (candles)" ao lado do buffer; exibir em `BacktestParams.jsx`.
4. Testes `buffer-expiry.test.js`: limite não tocado dentro de N candles → nenhuma entrada + warning; tocado no candle seguinte → entra; `bufferExpiryCandles = 2` → janela maior; buffer 0 → sem mudança de comportamento.

## FASE 6 — VERIFICAÇÃO E ACEITE

1. `npm run build` + testes verdes nos dois repos. Revisar o diff garantindo que **nenhum parâmetro de criação de ordem mudou** — só o tempo de espera e o cancelamento.
2. Aceite:
   - [ ] Configurar o timeframe na estratégia SUIUSDT (1h) e reproduzir o cenário: sinal → ordem viva até o fechamento do candle seguinte → preenche quando o preço cruza o buffer.
   - [ ] Ordem não preenchida dentro do candle → cancelada com a mensagem nova de expiração (não a genérica).
   - [ ] Sinal oposto durante a espera → `[BUFFER CANCEL]` como hoje.
   - [ ] Reiniciar o serviço com ordem pendente → o position-sync assume e cancela/protege corretamente.
   - [ ] Estratégia sem timeframe → comportamento idêntico ao atual (5 min).
   - [ ] Backtester com a mesma config reproduz a mesma entrada do bot.

---

## OBSERVAÇÃO IMPORTANTE

Esta mudança **altera o ciclo de vida de ordens em produção** (dinheiro real). Recomendo: aplicar, subir, e configurar o timeframe em **uma** estratégia primeiro, observar alguns sinais, e só então preencher o timeframe nas demais. Enquanto o campo estiver vazio, a estratégia opera exatamente como hoje.

## PROMPT PARA O CLAUDE CODE CLI

```
# Sessão 1 — repo Trading-Bot
Leia PLANO_FIX_BUFFER_EXPIRACAO.md na raiz e execute as FASES 1 a 4, uma por commit.
REGRAS CRÍTICAS: não mudar o cálculo do preço do buffer nem os parâmetros enviados
à corretora; estratégia sem timeframe DEVE manter o comportamento atual de 5 minutos;
a criação de proteção após o fill continua com o prazo curto atual. Sem comentários
em código. npm run build + testes verdes por fase. Liste mudanças por arquivo.

# Sessão 2 — repo singularity
Leia PLANO_FIX_BUFFER_EXPIRACAO.md na raiz e execute a FASE 5.
Não regredir nada do engine (parciais, RMA, paridade, sessões, intrabar, HTF).
npm run build && npx vitest run verdes. Liste mudanças por arquivo.
```
