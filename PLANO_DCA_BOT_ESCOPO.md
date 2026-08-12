# DCA no BOT (Trading-Bot) — Escopo, Riscos e Estimativa

Contraparte real do DCA que será feito no backtester. Aqui o custo NÃO é a matemática do preço médio — é a execução real na corretora, com dinheiro, latência, filtros de mercado e estados de erro.

## A DIFERENÇA FUNDAMENTAL (por que o bot é muito mais caro que o backtester)

O bot HOJE é **reativo**: só age quando chega um webhook do TradingView. O `allowAveraging` que já existe apenas adiciona uma entrada quando um NOVO sinal do mesmo lado chega — o TradingView é quem decide.

O DCA que o cliente quer é **automático e proativo**: o próprio bot precisa vigiar o preço e disparar as camadas ao se aproximar do SL, SEM sinal do TradingView. Isso é uma mudança de arquitetura — o bot precisa de um componente que monitore preço continuamente e coloque/gerencie ordens por conta própria. É a maior parte do custo.

Existe base reaproveitável: `position-sync.service.ts` (956 linhas) já reconcilia posições com a exchange periodicamente, e o WebSocket de mercado (`binance-ws`) já existe. Mas nenhum deles hoje dispara camadas de DCA.

## O QUE PRECISA SER CONSTRUÍDO

### 1. Config da estratégia (entity + migração)
Campos novos em `strategy.entity.ts`: `dcaEnabled`, `dcaLayers`, `dcaSpacingPct` (ou "colar antes do SL"), `dcaSizeMode` ('fixed'|'martingale'|'multiplier'), `dcaSizeFactor`, `dcaBasketTpPct`, `dcaMaxTotalMargin`. Migração SQL (o projeto usa migrações — seguir o padrão de `migration-remove-dryrun...`).

### 2. Colocação das camadas (duas abordagens, escolher)
- **(A) Ordens LIMIT escalonadas** já na entrada: coloca as N ordens de DCA como limit nos preços-gatilho no momento em que abre a posição. Mais simples e resiliente a queda do bot (as ordens vivem na exchange), mas ocupa margem reservada e exige recolocar TP a cada fill.
- **(B) Monitor ativo por WebSocket**: escuta o preço e dispara MARKET quando cruza o gatilho. Mais fiel ao backtester (que usa preço do candle), porém se o bot cair, o DCA não acontece — precisa do position-sync como rede de segurança.
Recomendo **(A)** para produção (ordens na corretora sobrevivem a restart), com o position-sync detectando fills e reconciliando. Definir isso é decisão de projeto e afeta a estimativa.

### 3. Recálculo e recolocação de SL/TP a cada camada
A cada fill de camada: cancelar o TP antigo, recalcular o preço médio real (usar o avgPrice/fill REAL da exchange, não o teórico), criar novo TP de cesta em `avgEntry ± basketTpPct`, e reajustar/manter o SL. Isso envolve cancel+create atômico o quanto possível, com tratamento dos erros -4061 (positionSide), -2021 (would immediately trigger), -1111 (precision), reduceOnly, etc. — todos os quais o código já enfrenta hoje para SL/TP simples.

### 4. Filtros de mercado da corretora (o "depende dos parâmetros da corretora")
Cada camada precisa respeitar, por símbolo e por corretora: `tickSize` (preço), `stepSize`/`qtyStep` (quantidade), `minNotional`/`minOrderValue`, `maxLeverage`, e a **tabela de margem de manutenção por faixa de nocional** (muda a liquidação conforme a posição cresce com o DCA — ponto crítico e diferente entre Binance e Bybit). Buscar e cachear `exchangeInfo`/`instruments-info`. Quantizar cada ordem. Recusar camada que viole minNotional ou empurre a liquidação para dentro do próximo gatilho.

### 5. Margem isolada vs cruzada
Em isolada, cada camada consome margem própria e aproxima a liquidação da posição. Em cruzada, usa o saldo da conta. O bot precisa verificar margem disponível antes de cada camada (`availableBalance`) e abortar com log claro se insuficiente — nunca deixar a corretora rejeitar silenciosamente.

### 6. Segurança e idempotência
- `dcaMaxTotalMargin` como teto duro: nunca ultrapassar, mesmo que o preço continue contra.
- Idempotência: se o bot reiniciar no meio de um ciclo de DCA, o position-sync precisa reconstruir o estado (quantas camadas já preencheram, qual o TP vigente) a partir da exchange + banco, sem duplicar ordens.
- Registro de cada camada em `trade_execution` (entity já existe) para o auditor reconciliar.
- Interação com hedge/one-way e com o `allowAveraging` atual (definir precedência; provavelmente DCA e averaging-por-sinal são mutuamente exclusivos por estratégia).

### 7. Auditoria e paridade com o backtester
O auditor (`auditor.service.ts`) passa a reconciliar as camadas de DCA reais contra as ordens da exchange (preço médio real vs teórico, fees por camada). E a validação webhook×backtester (PLANO_VALIDACAO_V6) ganha um caso a mais: comparar o preço médio e o nº de camadas do bot real com o backtester.

## RISCOS (é dinheiro real)
- Liquidação por cálculo errado da margem de manutenção em faixa alta de nocional → perda real. Mitigar com testes em testnet e teto de margem.
- Ordem duplicada em restart → posição maior que o pretendido. Mitigar com idempotência via position-sync.
- Divergência de filtros entre Binance e Bybit (nomes, campos, arredondamento). Mitigar testando nas duas.
- Ordem "would immediately trigger" quando o gatilho está muito perto do preço atual. Tratar como no SL/TP hoje.

## ESTIMATIVA DE ESFORÇO

| Bloco | Esforço |
|---|---|
| Entity + migração + config na UI do bot (frontend) | 3–5 h |
| Colocação das camadas (abordagem A: limit escalonadas) + fills via position-sync | 8–12 h |
| Recálculo/recolocação de SL + TP de cesta a cada camada (Binance + Bybit) | 8–12 h |
| Filtros de mercado (tick/step/minNotional/margem de manutenção por faixa) por corretora | 6–10 h |
| Margem isolada/cruzada, verificação de saldo, teto de margem, idempotência/restart | 6–9 h |
| Auditoria das camadas + paridade com backtester | 3–5 h |
| Testes automatizados + **testes em testnet nas duas corretoras** (obrigatório) | 8–12 h |
| Hardening, tratamento de erros, revisão | 4–6 h |
| **Total** | **46–71 h** |

Faixa provável: **~55 horas** — roughly **2,5–3× o backtester**. A maior parte do custo está em execução real (filtros de corretora, recolocação de ordens, idempotência) e nos testes em testnet, que não têm equivalente no backtester.

## SOBRE PREÇO E COMO VENDER
Não defino seu valor — depende da sua taxa e da sua margem. Base para montar: ~55 h (faixa 46–71 h). Recomendações comerciais:
- Cobre o bot SEPARADO do backtester e com valor maior — não é "o mesmo recurso no outro lugar", é execução financeira real com risco.
- Se for escopo fechado, inclua margem generosa: a interação margem de manutenção × DCA em cross e o teste nas duas corretoras são onde o tempo estoura.
- Condicione a entrega a validação em testnet antes de liberar em conta real — protege você e o cliente.
- Faseamento recomendado: **Fase 1** — DCA em margem isolada, uma corretora (a que o cliente usa hoje), ordens limit escalonadas, teto de margem (~30–35 h, já resolve o pedido). **Fase 2** — segunda corretora + margem cruzada + otimizações. Isso reduz o ticket inicial e o risco.

## SEQUÊNCIA RECOMENDADA
1. Fazer o DCA no backtester primeiro (PLANO_DCA_ESCOPO.md no singularity) — vira a especificação numérica e o oráculo de teste do bot.
2. Só então o bot, usando o backtester como referência de "qual deveria ser o preço médio / nº de camadas / TP de cesta" para cada cenário.

## PROMPT PARA O CLAUDE CODE CLI (quando aprovar, e SÓ após o DCA do backtester)
```
Leia PLANO_DCA_BOT_ESCOPO.md e implemente o DCA no Trading-Bot pela Fase 1
(isolada, uma corretora, limit escalonadas, teto de margem). Reaproveite
position-sync para detectar fills e reconstruir estado em restart. NUNCA
ultrapassar dcaMaxTotalMargin. Todo caminho de ordem tratado para erros
-4061/-2021/-1111. Testes automatizados + roteiro de testnet antes de conta real.
Não quebrar o fluxo de webhook/SL/TP existente. Liste mudanças por arquivo.
```
