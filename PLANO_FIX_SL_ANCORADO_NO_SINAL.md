# PLANO_FIX_SL_ANCORADO_NO_SINAL — O Stop Loss fica preso no preço do sinal em ordens com buffer

## RESPOSTA CURTA

**Sim, é a mesma operação. Sim, há erro. E não é caso isolado — é sistemático.**

O Stop Loss foi calculado sobre o preço do **sinal** (05/09), e não sobre o preço em que a ordem com buffer realmente **preencheu** (06/09, 22h depois). Como o preço andou 1,30% nesse intervalo, o stop de 2% virou um stop de 0,69%.

---

## 1. É A MESMA OPERAÇÃO?

Sim. Os preços são idênticos nos dois lados: **0.796 → 0.8015**. O horário também bate — a corretora fechou às `05:40:10 UTC`, e o gráfico do app mostra `Close 09:40` (fuso local UTC+4).

A confusão vem da **duração**:

| | Abertura | Duração |
|---|---|---|
| Corretora | 06/09 05:10:30 (o **fill**) | 29 min |
| Bot | 05/09 11:00:06 (a **ordem LIMIT**) | 22h 40m |

`05/09 11:00 + 22h40 = 06/09 09:40` — exatamente o fechamento. Os dois estão internamente corretos: o bot conta desde que **colocou a ordem**, a corretora desde que a **posição abriu**. A ordem com buffer ficou **22h11m pendente** antes de preencher — comportamento esperado desde que removemos a expiração do buffer.

## 2. A CONTA DA CORRETORA CONFERE

| Item | Valor |
|---|---|
| Variação (SHORT) | `(0.8015 − 0.796) / 0.796` = **0,6910%** |
| PnL bruto | `(0.796 − 0.8015) × 50` = **−0,2750** |
| Taxas | `0.00796 + 0.02204125` = **0,0300** |
| **PnL líquido** | **−0,3050** ✓ idêntico ao informado |

## 3. A PROVA DO BUG

Stop Loss configurado: **2%**. Para um SHORT com entrada em 0.796, o stop deveria estar em:

```
0.796 × 1.02 = 0.81192
```

Mas a posição fechou em **0.8015** — o stop disparou **1,31 pontos percentuais antes**.

Agora a pergunta decisiva: **que preço base geraria um stop de 2% em 0.8015?**

```
0.8015 / 1.02 = 0.785784
```

E `0.785784` está **1,30% abaixo** do preço de preenchimento real (0.796). Ou seja: **o stop foi ancorado no preço do sinal de 22 horas antes.**

## 4. CAUSA RAIZ NO CÓDIGO

**Defeito A — `resolveProtectionPrice` devolve o preço do sinal para ordens LIMIT**

`webhook/protection-price.util.ts`:
```ts
if (!isLimitOrder && actualEntryPrice && !isAveragingTrade) {
  return { price: actualEntryPrice, usedActualFill: true };
}
return { price: signalPrice, usedActualFill: false };
```
Com `isLimitOrder === true`, sempre cai no `signalPrice`. A premissa era que uma ordem LIMIT preenche no próprio preço da ordem — **falso quando existe buffer**, porque a ordem é colocada com offset e pode preencher horas depois, a um preço bem diferente.

`webhook.service.ts:2633` usa esse valor para criar o SL:
```ts
stopLossPrice = this.calculateStopLossPrice(side, priceForProtectionOrders, resolvedStrategy.stopLossPercentage);
```

**Defeito B — o fill monitor sabe o preço certo, mas não corrige o que já existe**

`webhook.service.ts:1436-1453` — o monitor calcula corretamente sobre `actualEntryPrice`, **porém só se o SL ainda não existir**:
```ts
if (!hasStopLoss && strategy.stopLossPercentage > 0) {
  const slPrice = this.calculateStopLossPrice(side, actualEntryPrice, ...);   // correto
  ...
} else if (hasStopLoss) {
  this.logger.debug(`[BYBIT LIMIT SL/TP] SL already exists, skipping creation`);   // ← o bug
}
```
Como o SL já tinha sido criado no caminho principal (com o preço do sinal), o monitor **pula** e mantém o stop desalinhado. **O mesmo vale para os TPs** (linha ~1520, `TPs already exist, skipping creation`).

### Sequência exata do trade do print

1. **05/09 11:00:06** — sinal a ~0.7858. Bot coloca a ordem LIMIT com buffer **e cria o SL em 0.8015** (2% sobre o sinal).
2. Ordem fica **22h11m** pendente.
3. **06/09 05:10:30** — preenche a **0.796**, 1,30% acima do sinal.
4. Fill monitor roda, vê `hasStopLoss = true` e **pula o recálculo**.
5. **05:40:10** — o SL em 0.8015 dispara: **0,69% de perda**, não os 2% configurados.

### Por que isso é grave e vai piorar

Não é aleatório: **quanto mais tempo a ordem fica pendente, mais o stop se desalinha.** E desde a remoção da expiração do buffer, ordens podem ficar pendentes por dias. O erro é assimétrico nos dois sentidos:

- preço andou **contra** o sinal → stop apertado demais (o caso do print), ou até **já disparado no nascimento**
- preço andou **a favor** → stop largo demais, **risco real muito maior que o configurado**

Com alavancagem, a segunda hipótese é a perigosa.

## 5. OS OUTROS DOIS PROBLEMAS DOS PRINTS

**Defeito C — PnL do bot (−0,49) diverge da corretora (−0,3050)**

`stop-loss.service.ts:427,631` usa `this.calculatePnL(trade, currentPrice)` — cálculo **local**. Uma busca por `closedPnl`, `cumExecFee`, `avgPrice` e `realizedPnl` no arquivo **não retorna nada**: o serviço nunca lê o resultado realizado da corretora.

É a mesma classe de defeito que o `PLANO_FIX_TP_REGISTRO` corrigiu para os Take Profits — **o caminho do Stop Loss ficou de fora**.

**Defeito D — a UI mistura tempo pendente com tempo em posição**

O card mostra `22h 40m`, que é o tempo desde a criação da ordem. A corretora mostra 29 min, o tempo em posição. São grandezas diferentes, e exibir só uma faz parecer que são operações distintas — foi o que gerou sua dúvida.

---

## REGRAS

1. Sem comentários em código. `npm run build` + **≥ 275 testes verdes** por fase.
2. Não alterar as fórmulas `calculateStopLossPrice` / `calculateTakeProfitPrice` — o que muda é o **preço base**.
3. Reposicionar SL/TP **nunca** pode deixar a posição desprotegida: criar o novo antes de cancelar o antigo, ou cancelar e recriar com verificação imediata.
4. Se o preço real de preenchimento não estiver disponível, manter o comportamento atual **com `logger.error`** — nunca silenciosamente.

---

## FASE 1 — O PREÇO BASE PASSA A CONSIDERAR O FILL EM ORDENS LIMIT

`protection-price.util.ts`:

1. Nova entrada `hasBuffer: boolean` (ou `bufferPercentage`) em `ProtectionPriceInput`.
2. Regra corrigida: usar `actualEntryPrice` **sempre que ele existir e não for averaging** — inclusive em ordem LIMIT. O preço do sinal passa a ser apenas fallback:
   ```
   se (actualEntryPrice && !isAveragingTrade) -> actualEntryPrice
   senão -> signalPrice
   ```
3. Manter `usedActualFill` no retorno e registrar no log a diferença percentual entre sinal e fill.
4. Testes: LIMIT com buffer e fill 1,3% acima → usa o fill; LIMIT sem fill disponível → sinal + warning; MARKET → inalterado; averaging → inalterado.

## FASE 2 — REPOSICIONAR SL E TP QUANDO A ORDEM COM BUFFER PREENCHE

O ponto central. `webhook.service.ts`, nos dois fill monitors (Binance ~1172 e Bybit ~1437):

1. Trocar a condição `if (!hasStopLoss)` por uma que também **corrija um SL existente desalinhado**:
   - calcular o SL correto sobre `actualEntryPrice`
   - comparar com o preço do SL vigente
   - se a diferença exceder uma tolerância (sugestão: **0,05 pontos percentuais**), **cancelar e recriar** o SL no preço certo
2. Aplicar a mesma regra aos TPs (hoje `TPs already exist, skipping creation` mantém alvos ancorados no sinal).
3. Ordem das operações: **criar o novo SL antes de cancelar o antigo** sempre que a corretora permitir dois stops simultâneos; se não permitir, cancelar e recriar imediatamente, com verificação de que o novo existe — e alarme se falhar.
4. Registrar no trade um campo aditivo nullable `protectionRepricedAt` e logar `[SL REPRICE] sinal X → fill Y | SL Z → W`.
5. Se o reposicionamento falhar, **fechar a posição** ou emitir alerta crítico — nunca deixar rodando com stop errado em silêncio.

## FASE 3 — NÃO CRIAR PROTEÇÃO ANTES DO PREENCHIMENTO

A raiz do problema é que o SL nasce junto com a ordem LIMIT pendente, quando ainda não existe posição.

1. Em ordem LIMIT com buffer, **não criar SL/TP no caminho principal**. A proteção passa a ser responsabilidade exclusiva do fill monitor (e do `resumeLimitProtection` como rede).
2. Isso elimina a janela de desalinhamento na origem e simplifica a Fase 2 (que continua necessária para ordens já existentes e para o caminho de retomada).
3. Garantir que a criação pós-fill acontece dentro do orçamento de proteção já existente, e que a falha dispara o alarme de posição desprotegida.
4. **Atenção:** validar que nenhuma posição fica desprotegida entre o fill e a criação do SL. Testar explicitamente o cenário de reinício do processo com ordem pendente.

## FASE 4 — PNL DO STOP LOSS VINDO DA CORRETORA

`stop-loss.service.ts`:

1. Ao fechar por SL, ler o resultado realizado da corretora — Bybit `closed-pnl` / `execution list` (`closedPnl`, `avgExitPrice`, `cumExecFee`), Binance `userTrades` (`realizedPnl`, `commission`).
2. Gravar `exitPrice` e `pnl` a partir desses valores, com o cálculo local apenas como fallback + `logger.warn`.
3. Persistir as taxas separadamente para o card poder mostrar bruto × líquido.
4. Teste: fill de 50 SUI a 0.8015 com fees 0.030 → PnL gravado **−0,3050**, não −0,49.

## FASE 5 — UI: SEPARAR TEMPO PENDENTE DE TEMPO EM POSIÇÃO

1. Card do trade exibe **dois tempos**: `Pendente: 22h11m` e `Em posição: 29m`.
2. Mostrar `Sinal: 0.7858 → Fill: 0.796` quando houver divergência, com o percentual.
3. Badge quando `protectionRepricedAt` estiver preenchido ("SL reposicionado após o fill").
4. Exibir o SL efetivo em % sobre a entrada real, ao lado do configurado — a divergência fica visível na hora.

## FASE 6 — AUDITOR

Nova issue `SL_PERCENT_MISMATCH` (**ERROR**): em todo trade fechado por `STOP_LOSS`, comparar `|exitPrice − entryPrice| / entryPrice` com o percentual configurado. Diferença acima de 0,1 p.p. gera issue com configurado × efetivo.

Isso teria pego este caso automaticamente, no mesmo dia.

## FASE 7 — TESTES E ACEITE

1. Testes:
   - `resolveProtectionPrice` com LIMIT + fill divergente → usa o fill
   - fill monitor com SL existente desalinhado → cancela e recria; alinhado → não mexe
   - reposicionamento falho → alerta crítico, não segue em silêncio
   - ordem LIMIT pendente → **nenhum** SL/TP criado antes do fill (Fase 3)
   - reinício do processo com ordem pendente → proteção criada no fill
   - PnL de SL lido da corretora: cenário do print → −0,3050
   - auditor emite `SL_PERCENT_MISMATCH` para SL configurado 2% e efetivo 0,69%
2. `npm run build` + suíte verde.
3. Aceite prático:
   - [ ] Ordem com buffer que preenche horas depois: SL efetivo = **2%** sobre o preço de preenchimento
   - [ ] Log `[SL REPRICE]` mostrando sinal → fill e SL antigo → novo
   - [ ] PnL do card idêntico ao `Closed P&L` da Bybit
   - [ ] Card mostra tempo pendente e tempo em posição separados
   - [ ] Auditoria sem `SL_PERCENT_MISMATCH` nos trades novos

---

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_FIX_SL_ANCORADO_NO_SINAL.md na raiz e execute as FASES 1 a 7, uma por
commit. EXECUTE TODAS ATÉ O FIM — não pare no meio.

CONTEXTO CONFIRMADO POR NÚMEROS (SUIUSDT SHORT, Bybit, 06/09/2026):
entrada real 0.796, saída 0.8015, 50 SUI, Closed P&L -0.3050 (bruto -0.275 +
fees 0.030 — a conta da corretora confere). Stop Loss configurado: 2%. Para
entrada 0.796 o stop deveria estar em 0.81192, mas fechou em 0.8015 = 0,691%.
O preço base que geraria stop 2% em 0.8015 é 0.785784 — exatamente 1,30% ABAIXO
do preço de preenchimento. O stop foi ancorado no PREÇO DO SINAL de 22h antes.

A ordem LIMIT com buffer foi criada 05/09 11:00:06 e só preencheu 06/09 05:10:30
(22h11m pendente, comportamento esperado desde a remoção da expiração do buffer).

CAUSA RAIZ (dois defeitos que se somam):
A) protection-price.util.ts -> resolveProtectionPrice retorna signalPrice sempre
   que isLimitOrder é true. A premissa de que ordem LIMIT preenche no próprio
   preço é FALSA quando há buffer.
B) webhook.service.ts:1436-1453 (Bybit) e ~1172 (Binance): o fill monitor calcula
   o SL corretamente sobre actualEntryPrice, MAS só "if (!hasStopLoss)" — como o
   SL já existia (criado com o preço do sinal), cai no else que só loga
   "SL already exists, skipping creation" e mantém o stop desalinhado. O mesmo
   ocorre com os TPs (~1520).

MAIS DOIS DEFEITOS DOS MESMOS PRINTS:
C) stop-loss.service.ts:427,631 calcula o PnL localmente com calculatePnL e NUNCA
   lê o realizado da corretora (não há closedPnl/cumExecFee/avgPrice no arquivo).
   Por isso o bot mostrou -0.49 e a corretora -0.3050. É a mesma classe que o
   PLANO_FIX_TP_REGISTRO corrigiu para TPs — o caminho do SL ficou de fora.
D) A UI mostra 22h40m (tempo desde a ordem) enquanto a corretora mostra 29min
   (tempo em posição). Precisa exibir os dois.

REGRAS CRÍTICAS: não alterar as fórmulas calculateStopLossPrice/
calculateTakeProfitPrice — o que muda é o PREÇO BASE; reposicionar SL/TP NUNCA
pode deixar a posição desprotegida (criar o novo antes de cancelar o antigo, ou
recriar com verificação imediata e alarme se falhar); se o reposicionamento
falhar, fechar a posição ou emitir alerta crítico, nunca seguir em silêncio; se
o preço real de preenchimento não estiver disponível, manter o comportamento
atual COM logger.error.

Na FASE 3, ao parar de criar proteção antes do fill, testar explicitamente o
cenário de REINÍCIO DO PROCESSO com ordem pendente — nenhuma posição pode ficar
desprotegida entre o preenchimento e a criação do SL.

npm run build limpo e >= 275 testes verdes ao final de cada fase.
Sem comentários em código. Liste mudanças por arquivo e o que cada teste cobre.
```
