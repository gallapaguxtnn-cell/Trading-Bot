# PLANO_FIX_BUFFER — Remover a expiração: ordem com buffer só morre por sinal contrário

**MUDANÇA DE REGRA.** As FASES 1-4 do plano anterior (expiração no fechamento do candle seguinte) **já foram executadas** — commits `9b9c9f3`, `6b09c84`, `89cbd33`, `971a60d`. O cliente reviu a decisão: a ordem LIMIT com buffer deve permanecer viva **até preencher ou até chegar um sinal contrário**, exatamente como o backtester faz. Este plano **desfaz a expiração** e mantém o resto da infraestrutura (que está boa e continua útil).

Caso que motivou (SUIUSDT, buffer 0,30%, SHORT): limite correto em `0.69040 × 1.003 = 0.6924712`; o preço cruzou dentro da hora seguinte, mas a ordem já tinha sido cancelada.

## REGRAS

1. Sem comentários em código. `npm run build` + testes verdes ao final de cada fase.
2. **Não mudar** o cálculo do preço do buffer nem os parâmetros enviados à corretora.
3. **Não mexer** no `[BUFFER CANCEL]` por sinal contrário — está correto.
4. **Manter** o fechamento de emergência quando existir POSIÇÃO ABERTA sem proteção.
5. **Não remover colunas do banco.** `trade.pendingExpiresAt`, `strategy.timeframe` e `strategy.bufferExpiryCandles` permanecem (migração destrutiva é risco desnecessário). `timeframe` continua útil para o backtester; os outros dois ficam sem uso.
6. O backtester **não muda** — ele já mantém `pendings[side]` vivo até sinal oposto.

---

## ESTADO ATUAL DO CÓDIGO (verificado)

| Onde | O que existe hoje |
|---|---|
| `webhook/buffer-expiry.util.ts` | `TF_MS`, `normalizeTimeframe`, `resolveTimeframe`, `computeBufferExpiry`, `decideLimitSyncAction` (com ramo `'expire'`), `fillMonitorAttempts` |
| `webhook.service.ts` ~2587 | calcula `pendingExpiresAt` via `computeBufferExpiry` e grava no trade |
| `webhook.service.ts` ~1178 e ~1449 | `maxAttempts = fillMonitorAttempts(pendingExpiresAt, ...)` — o laço dura até a expiração |
| `webhook.service.ts` ~1416 e ~1761 | ao esgotar: cancela a ordem e marca `ERROR` com `'Ordem com buffer expirou...'` + `signalLog.markByTrade(..., 'skipped_buffer_expired', ...)` |
| `position-sync.service.ts` ~304 | `decideLimitSyncAction` → ramo `'expire'` cancela a ordem e marca ERROR |

O que **fica como está** (já correto e necessário): o handoff para o `position-sync`, o ramo `'protect'` (cria SL/TP quando preenche após restart), o tratamento de `Cancelled`/`Rejected` da corretora, e o `signal_log`.

---

## FASE 1 — DESLIGAR A EXPIRAÇÃO NA ORIGEM

`webhook.service.ts` (~2587-2595):

1. Parar de calcular a expiração: remover a chamada a `computeBufferExpiry` e gravar `pendingExpiresAt: null` ao criar o trade da ordem LIMIT com buffer.
2. Remover o import de `computeBufferExpiry` (e de `resolveTimeframe`, se ficar sem uso neste arquivo).
3. `strategy.timeframe` e `strategy.bufferExpiryCandles` deixam de influenciar a execução. Não remover as colunas.

## FASE 2 — MONITOR EM MEMÓRIA NÃO CANCELA MAIS

Nas duas funções gêmeas (Binance ~1178/1416 e Bybit ~1449/1761):

1. `maxAttempts`: substituir `fillMonitorAttempts(pendingExpiresAt, ...)` por uma janela fixa de acompanhamento próximo — `const maxAttempts = 360` com `delayMs = 10000` (60 minutos, polling de 10s). Isso **não é expiração**: é só até quando o processo acompanha de perto antes de passar o bastão ao cron.
2. Ao esgotar o laço **sem fill**: **não cancelar a ordem e não marcar `ERROR`**. Substituir todo o bloco atual (cancelamento + os dois ramos de mensagem em ~1416/~1761) por um log único:
   `[BUFFER] Ordem ainda pendente após 60min — acompanhamento transferido para o position-sync`.
   O trade permanece `OPEN` com a ordem viva na corretora.
3. **Manter intacto** o bloco de emergência para POSIÇÃO ABERTA sem proteção (fecha a posição) — é outro cenário e continua correto.
4. Manter o tratamento de `Cancelled`/`Rejected` vindos da corretora (marca ERROR, correto).
5. `fillMonitorAttempts` fica sem uso → remover a função e o seu teste, ou mantê-la apenas se algum outro ponto a usar (verificar antes).

## FASE 3 — POSITION-SYNC: REMOVER O RAMO DE EXPIRAÇÃO

1. `buffer-expiry.util.ts` → `decideLimitSyncAction`: remover o ramo `'expire'`. Ordem pendente (`New`/`PartiallyFilled`) retorna **sempre** `'keep'`, independentemente de `pendingExpiresAt`. Simplificar a assinatura removendo o parâmetro `pendingExpiresAt` e atualizar o tipo `LimitSyncAction` para `'keep' | 'protect' | 'none'`.
2. `position-sync.service.ts` (~304): remover o bloco `if (action === 'expire')` (o `cancelLimitEntryOrder` daquele caminho) e ajustar a chamada sem `pendingExpiresAt`. Manter `'protect'` e `'keep'` como estão.
3. `computeBufferExpiry` fica sem uso → remover a função e seus casos de teste em `buffer-expiry.util.spec.ts`. Manter `TF_MS`, `normalizeTimeframe` e `resolveTimeframe` se ainda houver uso; se não houver, remover também (verificar antes com busca).
4. Atualizar `buffer-expiry.util.spec.ts`: remover os testes de expiração e adicionar `decideLimitSyncAction` com ordem pendente antiga → `'keep'`.

## FASE 4 — CANCELAMENTOS LEGÍTIMOS (o que deve cancelar de verdade)

1. **Sinal contrário** — já implementado (`[BUFFER CANCEL]`). Não mexer.
2. **Sinal do mesmo lado com ordem pendente**: garantir que, com `allowAveraging = false`, o segundo sinal seja ignorado sem criar uma segunda ordem pendente do mesmo lado; com `allowAveraging = true`, permitir (mesma semântica já usada para posições).
3. **Estratégia pausada / `isActive = false` / `pauseNewOrders` / deletada** → cancelar as ordens LIMIT pendentes daquela estratégia. **Isto é novo e agora é essencial**: sem expiração, uma ordem esquecida pode preencher dias depois; pausar a estratégia precisa realmente desligá-la. Implementar no `position-sync` (que já itera estratégias e trades) com motivo `'Ordem cancelada: estratégia pausada/desativada'`.
4. Registrar no `signal_log` a decisão correspondente em cada caso.

## FASE 5 — TESTES E ACEITE

1. Testes (jest, clientes mockados):
   - Ordem pendente ao fim das 360 tentativas → **não** é cancelada; trade continua `OPEN`; nenhum `updateTrade` com `ERROR`.
   - `decideLimitSyncAction` com ordem `New` e `pendingExpiresAt` antigo → `'keep'` (garante que a expiração morreu).
   - `position-sync` com `Filled` sem proteção → `'protect'` cria SL/TP.
   - Ordem `Cancelled` na corretora → trade vira ERROR com o motivo real.
   - Sinal contrário com ordem pendente → cancela (comportamento preservado).
   - Estratégia pausada com ordem pendente → cancelada (novo).
2. `npm run build` + suíte verde. Revisar o diff confirmando que **nenhum parâmetro de criação de ordem mudou** — só quem cancela e quando.
3. Aceite prático:
   - [ ] Caso SUI: sinal → ordem viva além de 5 min → preenche ao cruzar o buffer → SL/TP criados.
   - [ ] Sinal contrário durante a espera → `[BUFFER CANCEL]`.
   - [ ] Restart do serviço com ordem pendente → position-sync mantém e protege ao preencher.
   - [ ] Pausar a estratégia com ordem pendente → ordem cancelada.
   - [ ] Nenhum trade novo com o erro "expirou no fechamento do candle seguinte".

---

## RISCOS QUE VOCÊ ESTÁ ACEITANDO

1. **Entrada tardia**: a ordem pode preencher horas ou dias depois, fora do contexto do sinal. É exatamente o comportamento do backtester — a vantagem é que os dois passam a concordar. Se incomodar, dá para religar a expiração depois (a infraestrutura fica no banco).
2. **Até ~5 min sem proteção** se o fill ocorrer depois que o monitor em memória saiu (>60 min) — o cron do position-sync cobre no ciclo seguinte.
3. **Ordens acumuladas no book** consumindo margem reservada. Acompanhar na corretora nas primeiras semanas. A Fase 4.3 (pausar cancela) é a válvula de escape.

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_FIX_BUFFER_EXPIRACAO.md na raiz e execute as FASES 1 a 5, uma por commit.
CONTEXTO: as fases do plano ANTERIOR (expiração por candle) já foram executadas nos
commits 9b9c9f3, 6b09c84, 89cbd33, 971a60d — este plano DESFAZ a expiração, não a
implementa. REGRAS CRÍTICAS: a ordem LIMIT com buffer NUNCA pode ser cancelada por
tempo; só por sinal contrário, por cancelamento na própria corretora, ou por
estratégia pausada/desativada. Não remover colunas do banco. Não mudar o cálculo do
preço do buffer nem os parâmetros enviados à corretora. Manter o fechamento de
emergência quando houver POSIÇÃO ABERTA sem proteção. Sem comentários em código.
npm run build + testes verdes por fase. Liste mudanças por arquivo.
```
