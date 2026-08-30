# PLANO_FIX_TP_MARKET_FALLBACK — Por que o TP sai a MERCADO e causa a divergência de %

## A CHARADA, RESOLVIDA

Sua intuição estava certa: **a divergência de percentual vem de o TP ser executado a mercado.**

O bot tem **dois mecanismos de TP concorrentes**:

| # | Mecanismo | Onde | Como executa | Resultado |
|---|---|---|---|---|
| 1 | Ordens **LIMIT** `reduceOnly` na corretora | `webhook.service.ts` (3 caminhos: 1285, 1557, 2733) | preenche exatamente no preço-alvo | **0,305% / 0,296%** ✓ |
| 2 | **Fallback por software** | `take-profit.service.ts` → `closePosition()` linha **968: `orderType: 'Market'`** | fecha a mercado no preço que o cron de 30s enxergou | **0,146% / 0,427% / 0,528%** ✗ |

O interruptor entre os dois está em `take-profit.service.ts` linhas 151-154:

```ts
if (trade.takeProfitOrderId && trade.takeProfitOrderId.includes(':')) {
  await this.checkExchangeTakeProfit(trade, strategy, exchange, apiKey, apiSecret);
  return;
}
// ↓ se takeProfitOrderId estiver VAZIO, cai no fallback e fecha a MERCADO
```

**Se as ordens LIMIT de TP não existirem no banco, o serviço assume o controle e fecha a mercado — silenciosamente.** Não há distinção entre "não existe TP por design" e "o TP falhou ao ser criado".

### Prova numérica com o seu print (SUIUSDT SHORT, 28/08)

| Evento | Horário | Dado |
|---|---|---|
| Open Short **LIMIT** (buffer) | 12:00:15 | preenchido a **0.7546**, 60 SUI ✓ |
| Close Short **Conditional** (SL) | **12:45:51** | trigger 0.7697 → **+2,0%** do entry (SL correto), depois **cancelado** |
| Close Short **Market** (TP) | 12:50:30 | preenchido a **0.7535**, 60 SUI |

Variação real: `(0.7546 − 0.7535) / 0.7546` = **0,1458%**. Configurado: **0,30%**.

O alvo de 0,30% ficava em **0.75234**. O preço passou por lá, o cron de 30 segundos detectou tarde, e a ordem a mercado executou a **0.7535** — o preço já tinha voltado. **Você recebeu menos da metade do alvo.**

Nos cards anteriores o erro foi para o outro lado (0,427%, 0,528%): o preço ultrapassou o alvo e a execução atrasada pegou preço melhor. **Erro aleatório nos dois sentidos — a assinatura de execução a mercado com detecção atrasada.** É por isso que todos os cards corretos são "TAKE PROFIT 3" com ordens na corretora, e todos os divergentes são fechamentos a mercado.

### Por que esse trade ficou sem TP LIMIT

**O SL foi criado às 12:45:51 — 45 minutos depois do fill das 12:00:15.** Isso denuncia o caminho: a proteção não foi criada no momento do preenchimento. O monitor em memória não viu o fill (ou o processo reiniciou), e só o `position-sync` percebeu, emitindo `limit.protection.resume` → `resumeLimitProtection()` (`webhook.service.ts:1722`).

Durante 45 minutos a posição ficou **sem SL e sem TP**. Quando a proteção enfim chegou, o SL entrou mas as ordens LIMIT de TP não — e às 12:50:30 o fallback a mercado fechou tudo.

Causas que impedem a criação dos TPs LIMIT, em ordem de probabilidade:
1. **O defeito de precisão do planner** (`PLANO_FIX_TP_PLANNER_STEP.md`): a última fatia não é múltipla do `qtyStep` e a Bybit rejeita a ordem. Todos os TPs falhando → `takeProfitOrderId` fica `undefined` → fallback.
2. `resumeLimitProtection` (linha 1727) retorna cedo com `if (trade.stopLossOrderId && trade.takeProfitOrderId) return;`, e no fluxo Bybit a criação de TP está sob `if (!hasTakeProfit && tpConfigs.length > 0)` (linha 1587) — combinações de estado parcial podem deixar só o SL.

### Dois agravantes no mesmo `closePosition()`

- **Linha 922-931:** se a fatia parcial normalizada ficar abaixo do `minQty`, o código **fecha a POSIÇÃO INTEIRA** em vez da parcial. Um TP1 de 33% vira fechamento de 100%. (No print, 60 SUI saíram de uma vez.)
- **Linha 928/969:** `closeQuantity.toFixed(3)` — casas decimais fixas, ignorando o `qtyStep` do símbolo. Funciona para SUI por acidente; quebra em ativos com step diferente.

### Sobre break-even / break again

Esses recursos movem o **Stop Loss**, não o TP. Eles não deveriam converter o TP em ordem a mercado — e no código não o fazem. A mudança que você percebeu não veio deles: veio do fallback de software assumindo o TP.

---

## REGRAS

1. Sem comentários em código. `npm run build` + testes verdes por fase.
2. **Fechar a mercado nunca pode ser o caminho normal do TP.** É último recurso, sempre auditável.
3. Não alterar as fórmulas de preço de TP/SL.
4. Nenhuma mudança no comportamento do SL (que é `STOP_MARKET` / `Market` com trigger por design — isso está correto).

---

## FASE 1 — O FALLBACK PARA DE SUBSTITUIR O TP LIMIT

`take-profit.service.ts` → `checkTakeProfit()`:

1. Quando `trade.takeProfitOrderId` estiver vazio numa posição aberta, a ação correta **não é fechar a mercado**: é emitir `limit.protection.resume` para tentar criar as ordens LIMIT que faltam, e retornar.
2. Persistir tentativas em `trade.tpWarnings` (`TP_MISSING_RETRY:n`). Após **3 ciclos** sem conseguir criar as LIMIT, aí sim liberar o fallback a mercado — como proteção real de lucro, não como caminho normal.
3. Quando o fallback executar, gravar `closeReason: 'TAKE_PROFIT_FALLBACK_MARKET'` (valor novo em `CloseReason`), para separar nos relatórios o que foi executado no alvo do que foi executado a mercado.
4. Log em `error` (não `log`) toda vez que o fallback disparar, com alvo × preço executado × diferença em pontos percentuais.

## FASE 2 — FECHAR A JANELA QUE DEIXOU O TRADE SEM PROTEÇÃO

1. `resumeLimitProtection()` (`webhook.service.ts:1722`): trocar a guarda `if (trade.stopLossOrderId && trade.takeProfitOrderId) return;` por verificação **independente** — se faltar só o TP, criar só o TP; se faltar só o SL, só o SL. Hoje um estado parcial pode não ser completado.
2. No fluxo Bybit (linha ~1587), a condição `!hasTakeProfit` deve considerar o caso de `takeProfitOrderId` existir mas apontar para ordens **canceladas/inexistentes** na corretora — validar contra a corretora antes de pular a criação.
3. Detecção de fill mais rápida para ordens LIMIT com buffer: hoje o monitor em memória faz polling de 10s por até 60 min e depois passa ao cron de 5 min. Reduzir o intervalo do `position-sync` **para trades LIMIT sem proteção** (varredura dedicada a cada 30s), de modo que a janela de desproteção não chegue a 45 minutos.
4. Alerta explícito quando um trade `OPEN` passar de **2 minutos** sem SL **ou** sem TP.

## FASE 3 — CORRIGIR A CAUSA DA FALHA DE CRIAÇÃO

Executar `PLANO_FIX_TP_PLANNER_STEP.md` (FASES A a E). Sem ele, os TPs LIMIT continuarão sendo rejeitados pela Bybit por precisão e o fallback continuará sendo acionado. **É pré-requisito deste plano.**

## FASE 4 — CORRIGIR `closePosition()`

`take-profit.service.ts`:

1. **Linhas 922-931:** parcial que não atinge `minQty` **não pode** virar fechamento total silencioso. Comportamento correto: agregar a fatia ao próximo nível de TP (ou pular o nível), registrando o motivo. Fechar 100% só quando o nível for realmente o último.
2. **Linhas 928/969:** substituir `toFixed(3)` por normalização pelo `qtyStep` real do símbolo, com `Decimal` (mesma abordagem do `tp-planner.util.ts`).
3. Usar o preço **realmente executado** (`avgPrice`/`cumExecQty` da resposta) para gravar `exitPrice` e PnL — não o `exitPrice` estimado passado como parâmetro.

## FASE 5 — VISIBILIDADE

1. `auditor.service.ts`: nova issue `TP_EXECUTED_AT_MARKET` (WARNING) quando um trade fechar com `TAKE_PROFIT_FALLBACK_MARKET`, mostrando alvo × executado.
2. `TradeCard`: badge distinguindo "TP executado no alvo (limit)" de "TP executado a mercado (fallback)". Você passa a ver na hora qual card é confiável.
3. Incluir no card a diferença em pontos percentuais entre o alvo configurado e o efetivo.

## FASE 6 — TESTES E ACEITE

1. Testes (jest, clientes mockados):
   - Trade `OPEN` sem `takeProfitOrderId` → **não** fecha a mercado; emite `limit.protection.resume`.
   - Após 3 ciclos sem conseguir criar as LIMIT → fallback dispara com `closeReason: 'TAKE_PROFIT_FALLBACK_MARKET'`.
   - `resumeLimitProtection` com SL presente e TP ausente → cria **só** o TP.
   - Parcial abaixo de `minQty` → **não** fecha a posição inteira.
   - Quantidade de fechamento normalizada pelo `qtyStep` (não `toFixed(3)`).
   - Auditor emite `TP_EXECUTED_AT_MARKET` no cenário do print.
2. `npm run build` + suíte verde. Diff sem nenhuma mudança no comportamento do SL.
3. Aceite prático:
   - [ ] Novo trade com buffer: TPs aparecem como **Limit** no histórico da Bybit, não Market.
   - [ ] Percentual efetivo = configurado (tolerância de tick).
   - [ ] Nenhum trade `OPEN` passa de 2 min sem SL e TP.
   - [ ] Se algum TP falhar, o card mostra o aviso em vez de fechar a mercado em silêncio.
   - [ ] Auditoria sem `TP_EXECUTED_AT_MARKET` nos trades novos.

---

## PROMPT PARA O CLAUDE CODE CLI

```
Execute PRIMEIRO o PLANO_FIX_TP_PLANNER_STEP.md (FASES A a E) — é pré-requisito.
Depois leia PLANO_FIX_TP_MARKET_FALLBACK.md e execute as FASES 1 a 6, uma por commit.

CONTEXTO CONFIRMADO: o bot tem dois mecanismos de TP concorrentes. O correto são
ordens LIMIT reduceOnly na corretora (webhook.service.ts). O outro é um fallback
por software em take-profit.service.ts -> closePosition() linha 968, que fecha a
MERCADO com o preço visto pelo cron de 30s.

O interruptor está em take-profit.service.ts:151 — se trade.takeProfitOrderId
estiver vazio, o serviço abandona as ordens da corretora e fecha a mercado, sem
distinguir "sem TP por design" de "o TP falhou ao ser criado".

PROVA (SUIUSDT SHORT, 28/08): entrada LIMIT do buffer preenchida 12:00:15 a 0.7546;
SL Conditional criado só 12:45:51 (45 min depois — a posição ficou sem proteção);
TP fechado a MARKET 12:50:30 a 0.7535 = 0,1458% quando o configurado era 0,30%
(o alvo era 0.75234 e o preço já tinha voltado quando o cron detectou). Os cards
com 0,305%/0,296% corretos são todos LIMIT; os divergentes (0,427%, 0,528%) são
todos fechamentos a mercado — erro aleatório nos dois sentidos.

REGRAS CRÍTICAS: fechar a mercado NUNCA pode ser o caminho normal do TP — só último
recurso, após 3 ciclos tentando criar as LIMIT, e sempre com closeReason
'TAKE_PROFIT_FALLBACK_MARKET' para ficar auditável; uma parcial abaixo do minQty
NÃO pode virar fechamento total silencioso (linhas 922-931); trocar toFixed(3) por
normalização pelo qtyStep real com Decimal; NÃO alterar o comportamento do SL
(STOP_MARKET com trigger está correto por design); não mudar fórmulas de preço.

Sem comentários em código. npm run build + testes verdes por fase.
Liste mudanças por arquivo e o que cada teste cobre.
```
