# PLANO_FIX_LOOP_E_SYNC_PORTFOLIO — Loop infinito de TP/SL e position-sync cego

## 1. O LOOP QUE VOCÊ ESTÁ VENDO

```
21:00:31  [TP FALLBACK MARKET] DOGEUSDT TP1 ... diff=0.0198%
          Failed to create order: current position is zero, cannot fix reduce-only order qty
21:01:00  [TP FALLBACK MARKET] ... diff=0.0427%     → falha igual
21:01:01  [TP FALLBACK MARKET] ...                  → de novo, 1s depois
21:01:30  [TP FALLBACK MARKET] ... diff=0.0083%     → de novo
21:01:31  [TP FALLBACK MARKET] ...                  → de novo
```

O TP tenta fechar → a Bybit recusa porque **não existe posição** → o trade continua `OPEN` no banco → o cron de 30s tenta de novo → **para sempre**. Cada ciclo queima chamadas de API e aproxima um rate limit.

Mesma coisa com o Stop Loss no log anterior. **Não é um problema novo: é o mesmo trade fantasma sendo perseguido indefinidamente.**

## 2. A CAUSA RAIZ — E ELA EXPLICA TUDO

`position-sync.service.ts:133-152`:

```ts
for (const strategy of activeStrategies) {
  if (strategy.exchange === Exchange.BINANCE) {        // ← linha 135
    ...
    if (this.binanceWs.isEnabled()) {
      this.logger.warn(`[WS] WebSocket enabled but not connected for ${strategy.name} - skipping to avoid IP ban`);
      continue;                                         // ← PULA a sincronização
    }
  }
  await this.syncStrategyPositions(strategy);
}
```

E o seu log mostra:

```
[WS] WebSocket enabled but not connected for FF1 1M TESTE - skipping to avoid IP ban
```

**`FF1 1M TESTE` é a estratégia da OKX** — o log anterior prova: `[STRATEGY CONFIG] FF1 1M TESTE | Exchange: okx`.

Uma estratégia OKX só pode entrar nesse `if` se `strategy.exchange` estiver valendo `binance`. E está: **a corretora real agora mora no portfólio, não na estratégia.**

`credentials-resolver.service.ts:59`:
```ts
exchange: portfolio.exchange,     // ← a corretora verdadeira
```

O `webhook.service` faz `{ ...strategy, ...credentials }` e usa a corretora resolvida. **O `position-sync` não** — ele lê `strategy.exchange` cru, que ficou com o valor legado (`binance`, o default) desde a migração para portfólios.

### O círculo vicioso

1. `position-sync` acha que toda estratégia de portfólio é Binance
2. Cai no skip do WebSocket e **nunca sincroniza** OKX nem Bybit
3. As posições fantasma **nunca são reconciliadas** — é exatamente o position-sync que fecharia um trade cuja posição não existe mais
4. O TP e o SL continuam perseguindo essa posição inexistente **a cada 30 segundos, indefinidamente**

**Um bug só, com três sintomas.** E é o mesmo padrão do `getAccountBalance`: código anterior à migração de portfólios que ficou lendo o campo legado da estratégia.

## 3. OS OUTROS DOIS PROBLEMAS DO LOG

### 3.1 `[CREDENTIALS]` a cada 10 segundos

Dezenas de linhas idênticas: `[CREDENTIALS] source=portfolio portfolioId=cc0a078f-...`, de 10 em 10 segundos, indefinidamente.

`resolveCredentials` é chamado em todo tick de todos os crons, **sem cache**, e cada chamada faz consulta ao banco e **descriptografia** (operação cara). Além de poluir o log a ponto de esconder erros reais, é desperdício em cima do que já está em loop.

### 3.2 Percentual de novo calculado sobre preço truncado

```
├─ Entry: 0.09 → Exit: 0.09 (+0.82%)
```
DOGE a 0.08745 aparece como `0.09`. O `.toFixed(2)` nos logs de TP e SL continua — e o percentual exibido sai desses valores arredondados, não dos reais.

---

## 4. REGRAS

1. Sem comentários em código. `npm run build` limpo e **≥ 472 testes verdes** por fase.
2. **Nenhuma leitura de `strategy.exchange` sem resolver o portfólio**, fora da camada de exchange.
3. **Nenhum ciclo de retry pode ser infinito.** Todo fallback precisa de limite e de estado terminal.
4. Bybit e Binance não mudam de comportamento.

## FASE 1 — PARAR O LOOP (urgente)

`take-profit.service.ts` e `stop-loss.service.ts`, em `closePosition`:

1. Tratar `current position is zero, cannot fix reduce-only order qty` (e equivalentes de Binance e OKX) como **estado terminal, não como erro transitório**: a posição não existe mais na corretora, então o trade deve ser **fechado no banco** com `closeReason: 'POSITION_NOT_FOUND'` e marcado `excludeFromStats = true`.
2. Antes de qualquer tentativa de fechamento, **consultar a posição real na corretora**. Se estiver zerada, encerrar o trade pelo caminho acima em vez de enviar ordem.
3. Contador de tentativas por trade: após **3 falhas consecutivas** de fechamento por qualquer motivo, parar de tentar, marcar `needsReconciliation = true` e emitir alerta. Nunca mais que isso.
4. Teste: trade com posição zerada na corretora → **uma** verificação, trade fechado, **nenhuma** ordem enviada, e o cron seguinte não tenta de novo.

## FASE 2 — POSITION-SYNC ENXERGA A CORRETORA CERTA (a causa raiz)

`position-sync.service.ts`:

1. Resolver as credenciais **antes** da decisão de corretora, e usar `credentials.exchange` no lugar de `strategy.exchange`:
   ```
   const resolved = await this.credentialsResolver.resolveCredentials(strategy);
   if (resolved.exchange === Exchange.BINANCE) { ...skip de WS... }
   ```
2. O skip do WebSocket passa a valer **só para Binance de verdade**. OKX e Bybit sincronizam sempre.
3. Log de boot do ciclo informando quantas estratégias foram sincronizadas e quantas puladas, por corretora — para essa cegueira não voltar despercebida.
4. Teste: estratégia OKX vinculada a portfólio, com `strategy.exchange = 'binance'` legado no banco → **é sincronizada**, não pulada.

## FASE 3 — VARRER O PADRÃO EM TODO O CÓDIGO

Este é o **terceiro** ponto encontrado com o mesmo defeito (`getAccountBalance`, o fallback `Exchange.BYBIT`, e agora o `position-sync`). Certamente há mais.

1. Buscar todo uso de `strategy.exchange`, `strategy.apiKey`, `strategy.apiSecret`, `strategy.isTestnet` e `strategy.isRealAccount` **fora** do `CredentialsResolver`. Cada ocorrência: passar a usar o valor resolvido.
2. Estender o `exchange-conditional-guard.spec.ts` para falhar quando esses campos forem lidos direto da entidade fora do resolver, com allowlist explícita para o próprio resolver e para migrações.
3. Se houver muitas ocorrências, considerar renomear os campos legados na entidade (ex.: `legacyExchange`) para que qualquer uso remanescente **quebre em tempo de compilação** em vez de silenciosamente.

## FASE 4 — CACHE DE CREDENCIAIS

1. Cachear o resultado de `resolveCredentials` por `strategyId`, com TTL curto (30-60s) e invalidação quando a estratégia ou o portfólio for alterado.
2. Rebaixar o log `[CREDENTIALS] source=portfolio ...` de `debug` para `verbose`, ou emiti-lo apenas quando a fonte **mudar** — hoje é uma linha a cada 10 segundos, por estratégia.
3. Teste: dez chamadas seguidas dentro do TTL → **uma** descriptografia.

## FASE 5 — PRECISÃO NOS LOGS

1. Substituir os `.toFixed(2)` das mensagens de TP e SL por formatação pelo `tickSize` do símbolo.
2. Calcular os percentuais exibidos a partir dos preços reais, não dos arredondados.
3. Teste: DOGE a 0.08745 aparece como `0.08745`, não `0.09`.

## FASE 6 — LIMPAR OS TRADES FANTASMA JÁ EXISTENTES

1. Endpoint manual `POST /admin/reconcile-ghost-trades?dryRun=true`: para cada trade `OPEN`, consultar a posição na corretora; se estiver zerada, listar (em `dryRun`) ou fechar com `POSITION_NOT_FOUND` e `excludeFromStats = true`.
2. `dryRun` é o padrão. Nunca em cron.
3. É o que encerra os trades que hoje estão alimentando o loop.

## FASE 7 — ACEITE

- [ ] Nenhuma repetição de `current position is zero` no log após um ciclo
- [ ] Log do position-sync mostra OKX e Bybit **sendo sincronizadas**, não puladas
- [ ] `[CREDENTIALS]` deixa de aparecer a cada 10s
- [ ] Logs de TP/SL mostram `0.08745`, não `0.09`
- [ ] `reconcile-ghost-trades` em `dryRun` lista os trades fantasma atuais
- [ ] Build limpo e ≥ 472 testes verdes

---

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_FIX_LOOP_E_SYNC_PORTFOLIO.md na raiz e execute as FASES 1 a 7, uma por
commit. EXECUTE TODAS ATÉ O FIM. A FASE 1 é urgente — há um loop rodando em
produção agora.

SINTOMA: [TP FALLBACK MARKET] DOGEUSDT seguido de "Bybit API Error: current
position is zero, cannot fix reduce-only order qty", repetindo a cada 30s
indefinidamente (21:00:31, 21:01:00, 21:01:01, 21:01:30, 21:01:31...). O mesmo
ocorre no stop-loss.service. O trade nunca sai de OPEN, então o cron tenta para
sempre, queimando rate limit.

CAUSA RAIZ — position-sync.service.ts:135:
  if (strategy.exchange === Exchange.BINANCE) { ... continue; }
O log mostra "[WS] WebSocket enabled but not connected for FF1 1M TESTE -
skipping to avoid IP ban", e FF1 1M TESTE é uma estratégia OKX (confirmado por
"[STRATEGY CONFIG] FF1 1M TESTE | Exchange: okx" em outro log). Ela só entra
nesse if se strategy.exchange valer 'binance' — e vale, porque desde a migração
para portfólios a corretora real mora no PORTFÓLIO:
credentials-resolver.service.ts:59 devolve exchange: portfolio.exchange. O
webhook.service usa { ...strategy, ...credentials }; o position-sync NÃO — lê
strategy.exchange cru, o campo legado.

CÍRCULO VICIOSO: position-sync trata toda estratégia de portfólio como Binance ->
cai no skip do WebSocket -> NUNCA sincroniza OKX/Bybit -> as posições fantasma
nunca são reconciliadas -> TP e SL perseguem posição inexistente a cada 30s para
sempre. Um bug só, três sintomas.

FASE 1 (urgente) — em take-profit.service.ts e stop-loss.service.ts closePosition:
tratar "current position is zero" (e equivalentes Binance/OKX) como ESTADO
TERMINAL, não erro transitório: fechar o trade no banco com closeReason
'POSITION_NOT_FOUND' e excludeFromStats = true. Consultar a posição real na
corretora ANTES de tentar fechar; se zerada, encerrar sem enviar ordem. Limite de
3 falhas consecutivas por trade, depois marcar needsReconciliation e alertar.
NENHUM ciclo de retry pode ser infinito.

FASE 2 — position-sync.service.ts: resolver credenciais ANTES da decisão de
corretora e usar credentials.exchange no lugar de strategy.exchange. O skip de
WebSocket passa a valer só para Binance de verdade. Teste: estratégia OKX com
strategy.exchange='binance' legado no banco É SINCRONIZADA.

FASE 3 — este é o TERCEIRO ponto com o mesmo defeito (getAccountBalance, o
fallback Exchange.BYBIT, e agora o position-sync). Varrer TODO uso de
strategy.exchange / apiKey / apiSecret / isTestnet / isRealAccount fora do
CredentialsResolver e migrar para o valor resolvido. Estender
exchange-conditional-guard.spec.ts para falhar nesse padrão, com allowlist. Se
houver muitas ocorrências, avaliar renomear os campos legados na entidade (ex.:
legacyExchange) para que uso remanescente QUEBRE EM COMPILAÇÃO.

FASE 4 — cachear resolveCredentials por strategyId (TTL 30-60s, invalidado ao
alterar estratégia ou portfólio) e rebaixar o log [CREDENTIALS] para verbose ou
só quando a fonte mudar: hoje é uma linha a cada 10s por estratégia, escondendo
erros reais. Teste: 10 chamadas no TTL -> 1 descriptografia.

FASE 5 — trocar .toFixed(2) dos logs de TP/SL por formatação pelo tickSize e
recalcular os percentuais sobre os preços reais ("Entry: 0.09 -> Exit: 0.09
(+0.82%)" vem de DOGE 0.08745 truncado).

FASE 6 — POST /admin/reconcile-ghost-trades?dryRun=true: para cada trade OPEN,
consultar a posição na corretora; zerada -> listar (dryRun) ou fechar com
POSITION_NOT_FOUND e excludeFromStats. dryRun é o padrão, nunca em cron. É o que
encerra os trades que alimentam o loop hoje.

REGRAS CRÍTICAS: nenhuma leitura de strategy.exchange sem resolver o portfólio
fora da camada de exchange; nenhum retry infinito; Bybit e Binance não mudam de
comportamento.

npm run build limpo e >= 472 testes verdes ao final de cada fase.
Sem comentários em código. Liste mudanças por arquivo e o que cada teste cobre.
```
