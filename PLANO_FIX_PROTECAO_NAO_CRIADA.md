# PLANO_FIX_PROTECAO_NAO_CRIADA — A proteção não está chegando na corretora

## 1. O QUE O PRINT MOSTRA

O SL de 0,50% fechando em 1,04% é **sintoma**, não a doença. Olhando os 6 trades juntos, aparece outra coisa:

| # | Par | Entrada | Saída | Motivo | Resultado |
|---|---|---|---|---|---|
| 1 | A | 0.08230000 | 0.08256000 | **TAKE PROFIT FALLBACK MARKET** | +0.00 |
| 2 | A | **0.08230000** | — | **OPEN** | — |
| 3 | B | 0.08480000 | 0.08449000 | **TAKE PROFIT FALLBACK MARKET** | +0.10 |
| 4 | B | **0.08480000** | — | **OPEN** | — |
| 5 | C | 0.08314000 | 0.08339000 | **TAKE PROFIT FALLBACK MARKET** | +0.08 |
| 6 | C | **0.08314000** | 0.08228000 | **Stop Loss** | **−0.36** |

**Três fatos que saltam:**

1. **Três pares com entrada idêntica.** Cada posição virou dois registros. Os dois "Abertas: 2" do topo são as metades órfãs dos pares A e B. No par C é pior: **a mesma posição fechou duas vezes** — uma com TP (+0.08) e outra com SL (−0.36).

2. **Todos os TPs saíram como `TAKE PROFIT FALLBACK MARKET`.** Três de três. Esse rótulo só existe quando o bot tenta N vezes criar as ordens LIMIT de TP na corretora, **não consegue**, e fecha a mercado como último recurso. O que era exceção virou regra.

3. **O SL de 0,50% executou a 1,034%.** Conta: `(0.08228 − 0.08314) / 0.08314 = −1,0344%`. O stop de 0,50% deveria disparar em **0.0827243**; executou em **0.08228** — **0,53% pior que o alvo**.

## 2. A OBSERVAÇÃO DO SEU CLIENTE É A CHAVE

> "o condicional só funciona quando tem um breakeven ou breakagain, e o stoploss paga limit quando fecha e não a mercado"

Ele está certo, e isso bate exatamente com o código.

`position-sync.service.ts:801` (breakeven / break again) é **o único caminho que cancela e recria a ordem de SL na corretora**. Se o condicional só aparece quando essas opções estão ligadas, é porque **no fluxo normal de entrada a criação do SL está falhando** — e o bot segue em frente sem ele.

`webhook.service.ts:2736`:
```ts
} catch (slError: any) {
  this.logger.error(`[SL] Failed to create Bybit SL order: ${slError.message}. Continuing with TP creation...`);
}
```
**A falha é engolida.** O trade continua, o dashboard mostra tudo normal, e a posição fica sem stop condicional na corretora.

## 3. A CADEIA COMPLETA

Quando SL e TP não chegam na corretora:

1. O **TP** cai no fallback por software → fecha a mercado com o preço que o cron de 30s enxergou → o rótulo `TAKE PROFIT FALLBACK MARKET` que aparece nos 3 trades.
2. O **SL** também vira software → o `stop-loss.service` fecha a mercado com o preço do cron → **0,50% configurado vira 1,034% executado**. O atraso do ciclo explica os 0,53% de diferença.
3. A posição fecha parcialmente ou deixa resíduo → o `position-sync` não encontra trade `OPEN` correspondente → **importa como posição órfã** → nasce o segundo registro do par.
4. Os dois registros contabilizam PnL → o acumulado fica errado.

**O SL a mercado não é o bug** — `createStopLossOrder` da Bybit está correto (`orderType: 'Market'` + `triggerPrice` + `triggerBy: 'MarkPrice'`), e é assim que deve ser: stop tem que garantir saída. **O bug é essa ordem não estar sendo criada.**

## 4. SIM, AFETA AS OUTRAS CORRETORAS

O `catch` que engole a falha, o fallback de TP e o import de órfã são **código comum**, fora da camada de exchange. Binance e OKX correm exatamente o mesmo risco. A OKX é a mais exposta: nunca operou de verdade e estrearia direto com esse buraco.

---

## 5. REGRAS

1. Sem comentários em código. `npm run build` limpo e **≥ 472 testes verdes** por fase.
2. **Posição aberta sem stop na corretora é o pior estado possível do sistema.** Nunca pode ser silencioso.
3. Não alterar `createStopLossOrder` — ele está correto nas três corretoras.
4. Não afrouxar nada que já funciona; só adicionar.

---

## FASE 0 — DESCOBRIR POR QUE A CRIAÇÃO FALHA (antes de codar)

O `catch` engole a mensagem da corretora, então a causa exata está só nos logs.

Pelo Railway CLI, em **somente leitura**:
```
railway logs --lines 2000 | grep -E "\[SL\]|\[TP|\[PROTECTION|FALLBACK|retCode"
```
Procurar e **reportar**:
- linhas `[SL] Failed to create ... SL order:` e a mensagem da corretora
- linhas `[TP...] Failed to create after retry:`
- `[PROTECTION WARNING]` e `[PROTECTION] FAILED`
- qualquer `retCode` diferente de 0
- se aparece `[SL] Bybit Stop Loss order created:` em algum trade

Os candidatos mais prováveis: quantidade fora do `qtyStep`, nocional abaixo do mínimo (DOGE a 0,08 com posição pequena chega perto), `positionIdx` errado, `reduceOnly` recusado, ou stop que dispararia imediatamente. **Reportar os números antes de corrigir.**

## FASE 1 — FALHA DE SL VIRA INCIDENTE, NÃO LOG

`webhook.service.ts:2736` e equivalentes:

1. Falhar a criação do SL passa a ser **erro tratado**, não `catch` silencioso: gravar `trade.slWarnings` com o motivo retornado pela corretora.
2. **Retry imediato** (2 tentativas, backoff curto) antes de desistir — muitos erros são de sincronismo logo após a entrada.
3. Se ainda assim falhar: marcar o trade como **desprotegido** em campo próprio (`unprotectedSince`), emitir alerta e exibir badge vermelho no card.
4. **Decisão de política, a confirmar com você:** posição que não conseguiu SL deve ser **fechada imediatamente** ou mantida com alarme? O plano implementa a variável `CLOSE_ON_SL_FAILURE` (default `false` = mantém com alarme), para você escolher sem novo deploy.

## FASE 2 — O SOFTWARE NÃO SUBSTITUI O CONDICIONAL EM SILÊNCIO

Mesmo tratamento que o TP já recebeu, agora para o SL. `stop-loss.service.ts`:

1. Antes de fechar por software, verificar se existe ordem de stop viva na corretora. Se **não** existe, **tentar recriá-la** (emitir `limit.protection.resume`) e retornar.
2. Só após `SL_MISSING_RETRY_LIMIT` tentativas sem sucesso, permitir o fechamento a mercado — gravando `closeReason: 'STOP_LOSS_FALLBACK_MARKET'`, espelhando o que já existe para o TP.
3. Logar em `error` com alvo × executado × diferença em pontos percentuais, como o TP já faz.
4. Isso transforma o caso do print em algo visível: você veria `STOP_LOSS_FALLBACK_MARKET` no card em vez de um "Stop Loss" que parece normal.

## FASE 3 — O FALLBACK DE TP VIROU REGRA: TRATAR COMO ALARME

3 de 3 trades fecharam por fallback. O mecanismo funciona, mas está mascarando o problema real.

1. Contador por estratégia: se **2 fechamentos consecutivos** forem por fallback, emitir issue `PROTECTION_NOT_REACHING_EXCHANGE` (**ERROR**) no auditor e destacar no painel de Avisos.
2. Incluir na issue a última mensagem de erro da corretora (vinda da Fase 1), para o diagnóstico não depender do Railway.

## FASE 4 — DUPLICAÇÃO DE TRADES (voltou)

Os 3 pares com entrada idêntica mostram que o caminho tratado no `PLANO_FIX_TRADES_DUPLICADOS` tem um furo remanescente.

1. Investigar por que a posição gera dois registros **quando a proteção falha** — provavelmente o trade é fechado localmente e o resíduo é importado como órfã, apesar da checagem já implementada.
2. Reforçar: antes de `importOrphanPosition`, procurar trade `CLOSED` **ou `OPEN`** do mesmo símbolo/lado com `entryPrice` dentro de 0,1% nas últimas 24h. Hoje a janela de comparação pode estar deixando escapar o par.
3. O par C (mesma posição fechando com TP **e** com SL) é o caso mais grave: gera PnL duplicado com sinais opostos. Adicionar teste com exatamente esse cenário.
4. Rodar o `dedupe` em `dryRun` sobre esses 6 trades e conferir se os 3 pares são detectados.

## FASE 5 — TESTES E ACEITE

1. Testes:
   - criação de SL falha → retry → persiste `slWarnings` e marca `unprotectedSince`
   - `CLOSE_ON_SL_FAILURE=true` → posição fechada; `false` → mantida com alarme
   - `stop-loss.service` sem ordem na corretora → tenta recriar, **não** fecha a mercado
   - após o limite de tentativas → fecha com `STOP_LOSS_FALLBACK_MARKET`
   - 2 fallbacks consecutivos → issue `PROTECTION_NOT_REACHING_EXCHANGE`
   - cenário do par C: mesma entrada fechando por TP e por SL → detectado como duplicata
2. `npm run build` + suíte verde.
3. Aceite prático:
   - [ ] Novo trade DOGE: log `[SL] Bybit Stop Loss order created:` presente
   - [ ] Ordem de stop **visível na Bybit** como condicional, sem depender de breakeven/breakAgain
   - [ ] TP aparecendo como Limit na corretora, **sem** `FALLBACK MARKET`
   - [ ] SL efetivo = 0,50% (±tick), não 1,04%
   - [ ] Um registro por posição, sem pares de entrada idêntica
   - [ ] Auditoria sem `PROTECTION_NOT_REACHING_EXCHANGE`

---

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_FIX_PROTECAO_NAO_CRIADA.md na raiz e execute as FASES 0 a 5.
Na FASE 0 PARE e me reporte os achados dos logs antes de codar. Depois siga até o
fim, uma fase por commit.

CONTEXTO (DOGEUSDT, Bybit, 13-15/09/2026): o cliente relatou SL configurado em
0,50% fechando em 1,04%. Conta: (0.08228 - 0.08314)/0.08314 = -1,0344%. O stop de
0,50% deveria disparar em 0.0827243 e executou em 0.08228 — 0,53% pior que o alvo.

MAS O SL É SINTOMA. Olhando os 6 trades do print juntos:
- TRÊS PARES com entrada IDÊNTICA (0.08230 / 0.08480 / 0.08314). Cada posição virou
  dois registros. No par 0.08314 a MESMA posição fechou duas vezes: uma com TP
  (+0.08) e outra com SL (-0.36).
- TODOS os 3 TPs fecharam como "TAKE PROFIT FALLBACK MARKET" — ou seja, as ordens
  LIMIT de TP NÃO estão sendo criadas na corretora. O que era exceção virou regra.

O CLIENTE DEU A PISTA: "o condicional só funciona quando tem breakeven ou
breakagain". Isso bate com o código: position-sync.service.ts:801 é o ÚNICO
caminho que cancela e recria a ordem de SL. Se o condicional só aparece com essas
opções ligadas, a criação no fluxo normal de entrada está FALHANDO — e
webhook.service.ts:2736 ENGOLE a falha com um catch que só loga e segue
("Continuing with TP creation...").

CADEIA: SL/TP não chegam na corretora -> TP cai no fallback a mercado e SL vira
fechamento por software com o preço do cron de 30s (daí 0,50% virar 1,034%) ->
sobra resíduo -> position-sync importa como órfã -> nasce o par duplicado -> PnL
contado duas vezes.

NÃO alterar createStopLossOrder: ele está CORRETO (orderType Market + triggerPrice
+ triggerBy MarkPrice). Stop DEVE sair a mercado. O bug é a ordem não ser criada.

AFETA TODAS AS CORRETORAS: o catch, o fallback de TP e o import de órfã são código
comum fora da camada de exchange. Binance e OKX têm o mesmo risco.

FASE 0 — diagnóstico: use o Railway CLI em SOMENTE LEITURA
(railway logs --lines 2000 | grep -E "\[SL\]|\[TP|\[PROTECTION|FALLBACK|retCode")
e me REPORTE: as mensagens de "[SL] Failed to create", "[TP...] Failed to create
after retry", "[PROTECTION WARNING]", qualquer retCode != 0, e se existe algum
"[SL] Bybit Stop Loss order created". Candidatos: quantidade fora do qtyStep,
nocional abaixo do mínimo (DOGE a 0,08 com posição pequena), positionIdx errado,
reduceOnly recusado, stop que dispararia imediatamente. NÃO corrija antes de
reportar os números.

REGRAS CRÍTICAS: posição aberta sem stop na corretora é o pior estado possível do
sistema e NUNCA pode ser silenciosa — falha de SL vira slWarnings + unprotectedSince
+ alerta, com retry antes de desistir; o fechamento por software NUNCA substitui o
condicional sem antes tentar recriá-lo, e quando acontecer deve gravar
closeReason 'STOP_LOSS_FALLBACK_MARKET' (espelhando o que o TP já faz); implementar
CLOSE_ON_SL_FAILURE (default false) para escolher entre fechar a posição ou manter
com alarme; não afrouxar nada que já funciona.

npm run build limpo e >= 472 testes verdes ao final de cada fase.
Sem comentários em código. Liste mudanças por arquivo e o que cada teste cobre.
```
