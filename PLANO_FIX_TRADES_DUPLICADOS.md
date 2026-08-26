# PLANO_FIX_TRADES_DUPLICADOS — Posição órfã importada duplica trades e infla o PnL acumulado

## O QUE OS CARDS MOSTRAM (evidência)

| # | Card | ENTRY | QTD | TIPO | Motivo | Variação |
|---|---|---|---|---|---|---|
| A | LONG +5.4555 | 0.65470 | **1790** | LIMIT | TAKE PROFIT 3 | **0,305%** ✓ |
| B | LONG +2.506 | **0.65470** | **895** | MARKET | MANUAL | 0,427% ✗ |
| C | LONG +0.2672 | 0.71930 | 140 | LIMIT | TAKE PROFIT 3 | **0,305%** ✓ |
| D | LONG +0.0565 | **0.71930** | **0.00000000** | MARKET | DUST AMOUNT | 0,528% ✗ |
| E | SHORT +3.0553 | 0.70930 | 1670 | LIMIT | TAKE PROFIT 3 | **0,296%** ✓ |
| F | SHORT — | 0.65255 | 139.56 | LIMIT | MANUAL ("Duplicate trade consolidated") | sem exit |

Padrão inequívoco:
- **A e B têm a MESMA entrada (0.65470)** e `895 ≈ 1790 − 890` (o TP1 do card A fechou 890). **B é o resto da posição de A, virou um trade novo.**
- **C e D têm a MESMA entrada (0.71930)**; D tem quantidade **zero** e motivo DUST. Mesmo padrão.
- Todos os corretos (0,305% / 0,296% ≈ 0,30% + tick) são **LIMIT com TP3 completo**. Todos os divergentes são **MARKET / MANUAL / DUST** — trades que nasceram de importação, não de sinal.
- **O PnL de A e B é somado no acumulado.** A mesma posição rende duas vezes.

## CAUSA RAIZ (confirmada no código)

**Passo 1 —** `take-profit.service.ts` `checkExchangeTakeProfit()` decide fechar o trade por cálculo LOCAL:
```ts
const positionFullyClosed = newQty <= 0.0001;   // newQty é calculado, não lido da corretora
if (allLevelsFilled || positionFullyClosed) { trade.status = 'CLOSED'; ... }
```
Se a soma dos TPs deixar resíduo por arredondamento de tick/step, o banco marca CLOSED **enquanto a corretora ainda tem posição aberta**.

**Passo 2 —** `position-sync.service.ts` (~linha 214) procura trades com `status: 'OPEN'` para aquele símbolo/lado. Como o trade acabou de ser fechado, não acha nenhum:
```ts
if (existingTrades.length === 0) {
  this.logger.warn(`[SYNC] Orphan position detected: ... - importing...`);
  await this.importOrphanPosition(strategy, position);
}
```
→ **cria um trade NOVO** com o `entryPrice` da posição (por isso a entrada idêntica), tipo MARKET (o import não sabe o tipo original) e a quantidade que restou.

**Passo 3 —** esse trade importado depois fecha sozinho e grava PnL próprio → **duplicação permanente no acumulado**.

O `consolidateTrades()` existe e funciona (card F prova), mas **só age enquanto a posição está ABERTA na corretora**. Se o resíduo fecha antes do cron de 5 min, os dois trades ficam com PnL e ninguém consolida.

## O QUE NÃO É BUG

**Quantidade 1790 → 1670 está CORRETA.** Com entrada em % da banca, o que é constante é o **valor**, não a quantidade de moedas:

| Trade | Quantidade | Preço | Nocional |
|---|---|---|---|
| LONG 19/08 04:00 | 1790 SUI | 0.65470 | **1.171,9 USDT** |
| SHORT 19/08 23:00 | 1670 SUI | 0.70930 | **1.184,5 USDT** |

O nocional **subiu ~1%** (banca cresceu). A quantidade de SUI caiu porque o preço subiu 8,3% no período. Comportamento esperado.

**A fórmula de variação está correta:** `(Saída − Entrada) / Entrada × 100`. Para SHORT ela devolve valor negativo quando há lucro (o preço caiu) — o módulo é o que interessa. Card E: `(0.70720 − 0.70930)/0.70930 = −0,296%` = 0,296% de lucro. Certo.

**Variação divergente em trades MARKET** (0,427%, 0,367%) tem causa separada, já mapeada em `PLANO_FIX_TP_SL_PRECO_BASE.md` — TP/SL calculados sobre o preço do sinal em vez do fill real, fora da Binance. **Executar aquele plano também.**

---

## REGRAS

1. Sem comentários em código. `npm run build` + testes verdes por fase.
2. Nenhuma mudança em colocação/cancelamento de ordens na corretora.
3. Nada de reescrever dados históricos automaticamente — correção de histórico só por endpoint manual.
4. Toda mudança de status de trade deve ser conservadora: na dúvida, **manter aberto** e registrar warning (melhor um trade aberto a mais do que uma posição órfã sendo duplicada).

---

## FASE 1 — NÃO FECHAR TRADE SEM CONFIRMAR A POSIÇÃO NA CORRETORA

`take-profit.service.ts` → `checkExchangeTakeProfit()`:

1. Antes de marcar `status = 'CLOSED'`, consultar a **posição real** na corretora (reusar o fetch de posições que o `position-sync` já usa; extrair para método compartilhado).
2. Se a posição ainda tiver tamanho **acima do `minQty` do símbolo**: não fechar. Atualizar `trade.quantity`/`binancePositionAmt` com o tamanho real e manter `OPEN`, com log `[TP] Posição ainda aberta na corretora (X) — trade mantido aberto`.
3. Se a posição estiver zerada ou abaixo do `minQty` (poeira irrecuperável): fechar normalmente, como hoje.
4. Se a consulta falhar: manter o comportamento atual (fechar) + `logger.warn` — nunca travar o fluxo.

## FASE 2 — IMPORT DE ÓRFÃ MAIS CRITERIOSO

`position-sync.service.ts`, antes de `importOrphanPosition`:

1. Buscar trades **CLOSED** do mesmo `strategyId + symbol + side` fechados nas últimas 24h. Se existir um cujo `entryPrice` bata com o `position.entryPrice` (tolerância 0,1%), **não importar**: reabrir esse trade (`status = 'OPEN'`, quantidade = tamanho da posição, `exitPrice/pnl` preservados nas execuções) e registrar `logger.warn('[SYNC] Resíduo de trade recém-fechado — reaberto em vez de importar duplicata')`.
2. Elevar o critério de dust: além de `minQty`, ignorar posições cujo **nocional** (`size × markPrice`) seja menor que um piso configurável (`ORPHAN_MIN_NOTIONAL_USDT`, default 1 USDT). Isso elimina os cards de quantidade ~0.
3. Marcar todo trade criado por import com um campo novo aditivo `origin: 'IMPORTED' | 'SIGNAL' | null` (nullable, default null = comportamento atual) para rastreabilidade.

## FASE 3 — PNL ACUMULADO SEM DUPLICATAS

1. Campo aditivo nullable em `trade.entity.ts`: `excludeFromStats: boolean` (default `false`).
2. Marcar `excludeFromStats = true` em: trades consolidados como duplicata (`consolidateTrades` já os identifica), trades com `closeReason = 'DUST_AMOUNT'`, e trades importados que forem identificados como resíduo pela Fase 2.
3. **Todas** as agregações (dashboard, estatísticas por estratégia, relatórios, auditor) passam a filtrar `excludeFromStats = false`. Buscar todos os pontos que somam `pnl` e aplicar o filtro.
4. Teste: dois trades da mesma posição, um marcado → o acumulado conta apenas um.

## FASE 4 — UI: AGRUPAR POR POSIÇÃO E SINALIZAR

`frontend/components/trades/TradeCard.tsx` e a listagem:

1. Agrupar visualmente trades da mesma posição (mesmo símbolo/lado/entryPrice em janela curta) — card principal com os fragmentos recolhidos dentro dele.
2. Badge visível quando `excludeFromStats` estiver ativo: "duplicata — não conta no resultado" / "poeira".
3. Exibir `origin: IMPORTED` como badge "importado da corretora", para o usuário entender por que aquele card existe.
4. Card sem `exitPrice` (como o F) deve mostrar o motivo real em vez de "- USDT".

## FASE 5 — AUDITOR DETECTAR SOZINHO

`auditor/auditor.service.ts`: nova issue `DUPLICATE_POSITION` (ERROR) quando existirem 2+ trades **fechados** do mesmo `strategyId + symbol + side` com `entryPrice` dentro de 0,1% e `closedAt` na mesma janela de 24h. Mensagem com os IDs e o PnL de cada um, para conferência imediata.

## FASE 6 — CORRIGIR O HISTÓRICO (manual, sob demanda)

`POST /api/auditor/dedupe/strategy/:id?dryRun=true` — varre o histórico, identifica os grupos duplicados pelo mesmo critério da Fase 5, e em `dryRun` apenas **lista** o que marcaria. Sem `dryRun`, aplica `excludeFromStats = true` nos duplicados e grava `AuditLog` de cada alteração. **Nunca em cron.**

Isso resolve o "resultado acumulado da época de testes" sem apagar nada.

## FASE 7 — TESTES E ACEITE

1. Testes (jest, clientes mockados):
   - TP preenche tudo mas corretora ainda tem posição > minQty → trade **não** fecha.
   - TP preenche e posição zerada → fecha normalmente (comportamento atual).
   - Órfã com entryPrice igual a trade fechado há 1h → reabre, **não** importa.
   - Órfã com nocional < 1 USDT → ignorada.
   - PnL acumulado ignora `excludeFromStats`.
   - Auditor emite `DUPLICATE_POSITION` no cenário A+B do print.
2. `npm run build` + suíte verde; diff sem nenhuma alteração em envio de ordem.
3. Aceite prático:
   - [ ] Rodar `dedupe` em dryRun na estratégia SUI e conferir se ele encontra os pares A+B e C+D.
   - [ ] Aplicar e verificar que o acumulado do dashboard cai para o valor real da corretora.
   - [ ] Novo ciclo completo de TP: um único card por posição, sem MANUAL/DUST extra.
   - [ ] Nenhum card novo com TIPO MARKET quando a estratégia opera com buffer/LIMIT.

---

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_FIX_TRADES_DUPLICADOS.md na raiz e execute as FASES 1 a 7, uma por commit.

CONTEXTO CONFIRMADO: take-profit.service.ts fecha o trade com base em cálculo local
(newQty <= 0.0001) sem confirmar a posição na corretora. Quando sobra resíduo, o
position-sync não encontra trade OPEN, trata como "posição órfã" e IMPORTA um trade
novo — que depois fecha com PnL próprio. Resultado: a mesma posição aparece duas
vezes (ex.: LONG 1790 LIMIT TP3 +5.4555 e LONG 895 MARKET MANUAL +2.506, ambos com
entry 0.65470) e o PnL acumulado fica inflado.

REGRAS CRÍTICAS: nenhuma mudança em colocação/cancelamento de ordens; na dúvida
manter o trade ABERTO e logar warning (nunca fechar sem confirmar posição zerada);
não reescrever histórico automaticamente — só pelo endpoint manual da FASE 6 com
dryRun; todos os campos novos são aditivos e nullable.

Sem comentários em código. npm run build + testes verdes por fase.
Liste mudanças por arquivo e o que cada teste cobre.
```

**Depois deste, executar `PLANO_FIX_TP_SL_PRECO_BASE.md`** — ele corrige a variação divergente nos trades MARKET (TP/SL calculados sobre o preço do sinal fora da Binance), que é a outra metade do que você observou.
