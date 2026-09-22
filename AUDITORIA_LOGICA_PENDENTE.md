# AUDITORIA_LOGICA_PENDENTE — O que eu deixei passar, e o que ainda está em aberto

## 1. POR QUE EU DISSE QUE VÃO CONTINUAR EXISTINDO BUGS

O `PLANO_DEFINITIVO_CORRETORAS` cura **uma classe**: corretora errada, credencial errada, caminho sem tratamento para OKX. Depois dele, isso vira impossível de escrever.

Mas ele **não toca** em outra classe inteira: como o bot decide **quanto** comprar, **quando** fechar, **como** dividir os TPs, **como** calcula o PnL. Essa lógica pode estar errada com a corretora perfeitamente correta.

São dois eixos independentes. O plano definitivo endireita o primeiro. O segundo nunca foi auditado de forma sistemática — só reagimos aos erros que você trouxe.

## 2. SIM, DEIXEI PASSAR COISAS

Respondendo direto à sua pergunta. Dois achados **novos**, desta revisão:

### 2.1 Divisão por zero no TP2 ⚠️

`take-profit.service.ts:222`:
```ts
const closePercent = tp2Qty / (100 - tp1Qty);
```

**Na sua configuração atual, `tp1Qty = 100`** (vi no print: TP1 com Qty 100%). Se o TP2 for habilitado mantendo isso:

```
closePercent = 33 / (100 - 100) = 33 / 0 = Infinity
closeQuantity = quantity * Infinity = Infinity
```

Hoje não dispara porque o TP2 está **desmarcado** — o ramo exige `tp2` preenchido. **É uma bomba armada:** no dia em que você habilitar o TP2 sem baixar o TP1, a ordem sai com quantidade inválida.

A linha 313, num caminho irmão, tem a guarda certa (`sumRemaining > 0 ? ... : ...`). A 222 não tem.

### 2.2 O estado do TP não é persistido antes da ação — é o que alimenta o loop

`take-profit.service.ts:217-220`:
```ts
trade.lastTpLevel = 1;                      // só em memória
trade.tpWarnings = clearTpMissingRetry(...); // só em memória
await this.closePosition(...);               // ← falha aqui
```

Quando `closePosition` falha (o `current position is zero` que você está vendo), **`lastTpLevel` nunca chega ao banco**. No ciclo seguinte ele ainda vale `0`, o TP1 dispara de novo, falha de novo — **para sempre**.

Isso detalha o mecanismo exato do loop que a Fase 1 do plano definitivo ataca. Vale incluir explicitamente: **persistir o estado antes de agir, ou reverter em caso de falha.**

### 2.3 TP1 com 100% torna TP2 e TP3 inertes (configuração, não código)

No seu print, TP1 está com **Qty 100%**. Isso significa que o TP1 fecha a posição inteira — **TP2 e TP3 nunca vão executar**, mesmo habilitados. Se a intenção é saída escalonada, a configuração precisa somar 100% entre os níveis (ex.: 33/33/34).

Não é bug do código, mas o sistema deveria **avisar** ao salvar. Hoje aceita em silêncio.

## 3. O QUE JÁ IDENTIFIQUEI E NUNCA FOI EXECUTADO

Estes viraram plano, mas os planos não foram rodados. Continuam valendo:

| Item | Onde está | Situação |
|---|---|---|
| **TPs LIMIT não estão sendo criados** (3 de 3 fechamentos por fallback a mercado) | `PLANO_FIX_PROTECAO_NAO_CRIADA.md` | **nunca executado** |
| **Webhook devolve 500 e o TradingView reenvia** (3 sinais em 12s → risco de 3 posições) | `PLANO_FIX_BALANCE_OKX_FALLBACK_BYBIT.md`, Fase 3 | não executado |
| **`percentOfPosition` errado** (890 de 895 exibido como "50%") | `PLANO_FIX_TP_SL_PRECO_BASE.md`, Fase 3 | nunca executada |
| **Falha de criação de SL engolida** por `catch` que só loga | `PLANO_FIX_PROTECAO_NAO_CRIADA.md`, Fase 1 | não executado |

O primeiro é o mais sério e é **lógica pura**: se os TPs LIMIT não chegam na corretora, todo fechamento vira mercado com o preço do cron de 30s — e aí **nenhum** percentual bate com o configurado. É provavelmente a origem das divergências que você notou entre o bot e a corretora.

## 4. A REVISÃO QUE EU PROPONHO

Você perguntou se quero revisar a lógica. Sim — mas com método, senão vira o mesmo ciclo reativo de sempre.

**A auditoria deve ser feita contra o backtester.** Vocês têm, no `singularity`, um motor que calcula exatamente o que *deveria* acontecer. Ele é o oráculo natural: pegar um período real, rodar a mesma estratégia nos dois, e comparar trade a trade. Onde divergir, ou o bot está errado, ou o backtester está — e nos dois casos você quer saber.

Essa é a ideia do `PLANO_IMPORTAR_DO_BOT_V7` e do `PLANO_VALIDACAO_V6`, que também nunca foram executados.

### As cinco áreas a auditar, por ordem de risco

**1. Dimensionamento da entrada** — `% da banca × alavancagem ÷ preço`, com `enableCompound` recalculando a cada trade. Se o saldo lido estiver errado (trades fantasma contaminando), todo tamanho subsequente fica errado. Conferir contra o nocional real na corretora.

**2. Divisão dos TPs** — a soma das fatias, o comportamento quando não somam 100%, o TP2 calculado sobre o restante (`tp2Qty / (100 - tp1Qty)`), e o caso do TP1 a 100%.

**3. Ciclo de vida do trade** — quando abre, quando fecha, quando é parcial, quando vira duplicata. É onde nascem as divergências de quantidade que você viu.

**4. PnL e taxas** — já corrigimos TP e SL para ler da corretora; falta confirmar que **todos** os caminhos de fechamento fazem isso (manual, sinal contrário, emergência).

**5. Interação entre recursos** — `Hedge Mode` + `Allow Averaging` + `Compound` ligados ao mesmo tempo, como no seu print. Cada um foi pensado isoladamente; juntos, a combinação nunca foi testada.

### Como eu faria, em ordem

1. **Primeiro terminar o `PLANO_DEFINITIVO_CORRETORAS`** (já em execução). Sem ele, qualquer auditoria de lógica é contaminada — você nunca sabe se o número errado veio da lógica ou da corretora errada.
2. **Executar o `PLANO_FIX_PROTECAO_NAO_CRIADA`**. Enquanto os TPs saírem a mercado, *nenhum* percentual vai bater, e toda comparação com a corretora fica sem sentido.
3. **Aí sim**: pegar 20-30 trades reais já fechados, e comparar linha a linha bot × corretora — entrada, saída, quantidade, taxas, PnL. As divergências que sobrarem são lógica de verdade.
4. Com as divergências mapeadas, rodar o mesmo período no backtester e ver qual dos dois está certo.

**Sem os passos 1 e 2, o passo 3 gera ruído, não diagnóstico.**

## 5. SOBRE AS DIVERGÊNCIAS QUE VOCÊ NOTOU

Você mencionou diferenças entre o que aparece na corretora e no bot. Pelo que já vimos, há pelo menos quatro causas possíveis simultâneas:

1. **TP a mercado** em vez de LIMIT → preço de saída diferente do alvo
2. **Trades duplicados/fantasma** → quantidade e PnL contados a mais
3. **`percentOfPosition` errado** → o card mostra fatia errada
4. **Logs com `.toFixed(2)`** → os números que você lê no log já vêm truncados

Se quiser, me mande **um** trade específico com o print da corretora ao lado. Com um caso concreto eu consigo dizer qual das quatro é — como fizemos no caso do SL de 0,50% que virou 1,04%. Caso a caso tem funcionado melhor do que auditoria genérica.

---

## CORREÇÕES PONTUAIS PARA ENTRAR NO PLANO EM EXECUÇÃO

Os dois achados novos são pequenos e devem ser acrescentados à Fase 1 do `PLANO_DEFINITIVO_CORRETORAS`, que já está rodando:

```
Acrescente à FASE 1 do PLANO_DEFINITIVO_CORRETORAS.md, no mesmo commit:

1. take-profit.service.ts:222 — "const closePercent = tp2Qty / (100 - tp1Qty)"
   faz DIVISÃO POR ZERO quando takeProfitQuantity1 = 100 (configuração real do
   usuário hoje), gerando Infinity e ordem com quantidade inválida. Aplicar a
   mesma guarda que a linha 313 já usa: se (100 - tp1Qty) <= 0, o nível é
   inalcançável — logar e NÃO executar, em vez de dividir.

2. take-profit.service.ts:217-220 — trade.lastTpLevel, tpWarnings e closeDetail
   são setados APENAS EM MEMÓRIA antes de closePosition(). Quando closePosition
   falha (o "current position is zero" atual), o estado nunca é persistido e o
   cron seguinte tenta o MESMO nível de novo — é o mecanismo exato do loop.
   Persistir o estado ANTES da ação, ou revertê-lo explicitamente em caso de
   falha. Teste: closePosition falha -> o ciclo seguinte NÃO repete o mesmo nível.

3. Validação na UI de estratégias: avisar quando a soma das quantidades dos TPs
   habilitados ultrapassar 100%, e quando TP1 = 100% com TP2/TP3 habilitados
   (nesse caso TP2 e TP3 nunca executam). Aviso, não bloqueio.
```
