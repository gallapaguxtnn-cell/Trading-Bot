# Roteiro de aceite — PLANO_FIX_BUFFER (remoção da expiração)

A ordem LIMIT com buffer só morre por: sinal contrário, cancelamento na própria
corretora, ou estratégia pausada/desativada/deletada. Nunca por tempo.

## Testes automatizados (verdes)

- `npm run build` limpo.
- `npx jest src/webhook/buffer-expiry.util.spec.ts`:
  - ordem pendente (`New`/`PartiallyFilled`) → `keep` (a expiração morreu).
  - `Filled` sem proteção → `protect`; com proteção → `none`.
  - `Cancelled`/`Rejected`/desconhecido → `none`.
  - `shouldCancelPendingForStrategy`: ativa e não pausada → `false`;
    desativada, pausada ou inexistente → `true`.
- Suíte completa verde (as 6 suítes que falham são pré-existentes: ESM do
  `https-proxy-agent`, sem relação com esta mudança).

## Aceite prático (manual, conta real/testnet)

- [ ] Caso SUI: sinal → ordem viva além de 5 min → preenche ao cruzar o buffer →
      SL/TP criados normalmente.
- [ ] Ordem pendente após 60 min: monitor em memória apenas loga
      `[BUFFER] Ordem ainda pendente após 60min — acompanhamento transferido para o position-sync`;
      trade continua `OPEN`, ordem viva na corretora.
- [ ] Sinal contrário durante a espera → `[BUFFER CANCEL]` cancela a ordem.
- [ ] Restart do serviço com ordem pendente → position-sync mantém a ordem e cria
      proteção quando preencher (evento `limit.protection.resume`).
- [ ] Ordem cancelada/rejeitada na corretora → trade vira `ERROR` com o motivo real.
- [ ] Pausar a estratégia (`isActive=false` ou `pauseNewOrders`) com ordem pendente →
      position-sync cancela no ciclo (5 min) e marca `Ordem cancelada: estratégia pausada/desativada`.
- [ ] Deletar a estratégia com ordem pendente → ordens LIMIT pendentes canceladas
      antes do delete.
- [ ] Nenhum trade novo com o erro "expirou no fechamento do candle seguinte".

## Infra mantida (sem uso na execução, por decisão)

- Colunas `trade.pendingExpiresAt`, `strategy.timeframe`, `strategy.bufferExpiryCandles`
  permanecem no banco (migração destrutiva é risco desnecessário; dá para religar a
  expiração no futuro).
