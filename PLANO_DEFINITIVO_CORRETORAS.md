# PLANO_DEFINITIVO_CORRETORAS — A cura, não mais um curativo

## 1. RESPOSTA HONESTA: OS PLANOS ANTERIORES NÃO RESOLVEM SOZINHOS

Você perguntou se isso resolve de uma vez. **Não.** Os planos que escrevi tratam sintomas — cada um corrige o ponto onde o erro apareceu. A doença é outra, e enquanto ela existir, **vão aparecer novos sintomas em lugares que ainda não visitamos.**

Prova: nos últimos dias achamos três bugs que pareciam independentes.

| Sintoma | Causa |
|---|---|
| `getAccountBalance` mandando chave da OKX para a Bybit | lia `strategy.exchange`, campo legado |
| `position-sync` pulando OKX e Bybit | lia `strategy.exchange`, campo legado |
| TP/SL em loop infinito | consequência do anterior |

**São o mesmo bug em três lugares.** E enquanto escrevia esta revisão, achei o quarto:

`take-profit.service.ts:811` — `getCurrentPrice(trade, strategy: any)`:
```ts
const exchange = strategy.exchange || Exchange.BINANCE;   // campo legado
if (exchange === Exchange.BYBIT) { ... }                   // OKX não tem ramo
if (strategy.isTestnet && exchange === Exchange.BINANCE) { ... }
else {
  // OKX cai aqui → exchangeService.getExchange(), que só conhece binance e bybit
}
```

Repare no `strategy: any`. O tipo `any` desligou a única defesa que restava — o compilador.

## 2. A DOENÇA: A MIGRAÇÃO DE PORTFÓLIOS FOI FEITA PELA METADE

Quando criamos os portfólios, a corretora e as credenciais mudaram de dono:

```
ANTES:  Strategy { exchange, apiKey, apiSecret, isTestnet, isRealAccount }
DEPOIS: Portfolio { exchange, apiKey, apiSecret, apiPassphrase, mode, region }
        Strategy  { portfolioId → Portfolio }
```

O `CredentialsResolver` foi criado para resolver isso. **Mas os campos antigos continuam existindo na `Strategy`**, e todo código escrito antes da migração continua lendo eles — silenciosamente, sem erro, devolvendo a corretora errada.

### O tamanho real, medido agora

`strategy.exchange`, `strategy.apiKey`, `strategy.apiSecret`, `strategy.isTestnet`, `strategy.isRealAccount` aparecem **128 vezes em 16 arquivos**. Descontando specs, o resolver e a migração, sobram **~91 ocorrências em serviços de produção**:

| Arquivo | Ocorrências |
|---|---|
| `take-profit.service.ts` | **22** |
| `webhook.service.ts` | **19** |
| `stop-loss.service.ts` | **18** |
| `auditor.service.ts` | 9 |
| `strategies.service.ts` | 9 |
| `position-sync.service.ts` | 7 |
| `user-data-stream.service.ts` | 6 |
| `binance-ws-init.service.ts` | 1 |

**Parte delas está correta** (recebe um `resolvedStrategy` como parâmetro), **parte está errada** (lê a entidade crua). E **não dá para distinguir olhando** — as duas se escrevem exatamente igual: `strategy.exchange`.

É por isso que os erros não acabam. Cada vez que você exercita um caminho novo — um TP parcial, um SL, uma reconciliação, um sinal contrário — pode esbarrar numa das que está errada.

## 3. A CURA: TORNAR IMPOSSÍVEL LER O CAMPO ERRADO

Não adianta revisar 91 pontos com disciplina — foi o que tentamos, e escapou. **A solução é fazer o compilador recusar o código errado.**

Três movimentos:

1. **Renomear os campos legados na entidade.** `exchange` → `legacyExchange`, `apiKey` → `legacyApiKey`, e assim por diante. **Tudo que quebrar na compilação é exatamente o que estava errado.** O compilador vira o auditor, e ele não esquece nem se distrai.
2. **Criar o tipo `ResolvedStrategy`.** Os serviços passam a aceitar **só** esse tipo, que carrega a corretora e as credenciais já resolvidas. Passar uma `Strategy` crua deixa de compilar.
3. **Eliminar todo `strategy: any`.** É o que permitiu o bug do `getCurrentPrice` passar.

Depois disso, o erro que perseguimos há dias **deixa de ser possível de escrever**.

---

## 4. REGRAS

1. Sem comentários em código. `npm run build` limpo e **≥ 472 testes verdes** por fase.
2. **Nenhuma fase pode ser pulada nem parcialmente aplicada.** A garantia vem de o compilador não ter brecha.
3. Comportamento de Bybit e Binance permanece idêntico — é refatoração de tipos, não de lógica.
4. Nenhum retry infinito em nenhum caminho.

---

## FASE 1 — PARAR O SANGRAMENTO (urgente, antes de tudo)

Há um loop rodando em produção. Isto vem primeiro, mesmo sendo paliativo.

1. Em `take-profit.service.ts` e `stop-loss.service.ts`: tratar `current position is zero, cannot fix reduce-only order qty` (e equivalentes de Binance e OKX) como **estado terminal** — fechar o trade com `closeReason: 'POSITION_NOT_FOUND'` e `excludeFromStats = true`.
2. Verificar a posição real na corretora **antes** de tentar fechar. Zerada → encerra sem enviar ordem.
3. Teto de **3 tentativas** por trade. Depois: `needsReconciliation = true` e alerta. **Nenhum retry infinito em lugar nenhum.**
4. `POST /admin/reconcile-ghost-trades?dryRun=true` para encerrar os trades fantasma que já estão presos.

## FASE 2 — O TIPO `ResolvedStrategy`

1. Criar em `common/resolved-strategy.type.ts`:
   ```
   ResolvedStrategy = Omit<Strategy, 'exchange'|'apiKey'|'apiSecret'|'isTestnet'|'isRealAccount'>
                    & { exchange, apiKey, apiSecret, apiPassphrase, isTestnet, isRealAccount,
                        portfolioId, region, source }
   ```
2. `CredentialsResolver.resolve(strategy)` passa a devolver `ResolvedStrategy` completo — não mais um objeto de credenciais que o chamador precisa mesclar à mão.
3. Cache por `strategyId` com TTL de 30-60s, invalidado ao alterar estratégia ou portfólio. Resolve também o `[CREDENTIALS]` que hoje polui o log a cada 10 segundos.

## FASE 3 — RENOMEAR OS CAMPOS LEGADOS (o movimento decisivo)

1. Em `strategy.entity.ts`, renomear as **propriedades TypeScript** mantendo os nomes das **colunas** no banco:
   ```
   @Column({ name: 'exchange' })   legacyExchange: Exchange;
   @Column({ name: 'apiKey' })     legacyApiKey: string;
   ...
   ```
   Nada muda no banco; só o nome no código. **Zero migração, zero risco de dados.**
2. `npm run build` vai falhar em todos os pontos errados. **Essa lista de erros é a auditoria completa** que tentamos fazer à mão e não conseguimos.
3. Corrigir um a um: quem precisa da corretora real passa a receber `ResolvedStrategy`.
4. Os únicos autorizados a ler `legacy*` são o `CredentialsResolver` e o `portfolio-migration.service`.
5. Após a fase, buscar `legacy` no código: fora desses dois arquivos, **zero ocorrências**.

## FASE 4 — ASSINATURAS TIPADAS, SEM `any`

1. Trocar todo `strategy: any` por `strategy: ResolvedStrategy` nos serviços — começando por `take-profit.service.ts:811` (`getCurrentPrice`), onde o `any` escondeu o bug da OKX.
2. Habilitar `noImplicitAny` no `tsconfig` se ainda não estiver, e corrigir o que aparecer.
3. Cada método que fala com corretora recebe `ResolvedStrategy` ou um `AccountContext` — nunca a entidade crua.

## FASE 5 — COBRIR OS BURACOS QUE A TIPAGEM REVELAR

Ao corrigir os erros de compilação, vão aparecer caminhos sem tratamento para OKX (como o `getCurrentPrice`). Para cada um:

1. Usar `exchangeFactory.get(resolved.exchange)` — nunca corretora literal.
2. Corretora sem client registrado → **erro explícito**, jamais fallback para outra.
3. Remover todo `exchangeFactory.get(Exchange.<LITERAL>)` fora de `src/exchange/`, salvo comportamento genuinamente exclusivo (ex.: `setTradingStop` da Bybit no `position-sync:801`), com allowlist declarada.

## FASE 6 — TRAVAS CONTRA REGRESSÃO

O projeto já tem dois guardas que funcionam (`toFixed(` em ordens, condicionais de corretora). Acrescentar:

1. Teste que falha se `legacy*` for lido fora do resolver e da migração.
2. Teste que falha se aparecer `strategy: any` em assinatura de serviço.
3. Teste que falha se `exchangeFactory.get(` receber literal fora de `src/exchange/`.
4. Teste que falha se algum `catch` de criação de SL/TP apenas logar sem persistir o motivo.

## FASE 7 — TESTE DE PARIDADE ENTRE CORRETORAS

O teste que teria evitado tudo isto.

1. Suíte parametrizada que roda **o mesmo cenário completo** para Binance, Bybit e OKX com clients mockados: sinal → entrada → SL e TP criados → TP1 parcial → SL move → fechamento → PnL lido da corretora → reconciliação.
2. Toda corretora registrada no factory **precisa** passar. Adicionar uma corretora nova sem implementar o ciclo inteiro **quebra o build**.
3. Cenários negativos obrigatórios: posição zerada, ordem rejeitada, credencial inválida, corretora fora do ar. Nenhum deles pode gerar loop.

## FASE 8 — ACEITE

- [ ] `grep legacy` fora do resolver e da migração → **zero**
- [ ] `grep "strategy: any"` nos serviços → **zero**
- [ ] Sinal OKX: saldo, preço, ordem, SL, TP e sync **todos na OKX**, zero menção a `BybitClientService`
- [ ] Sinal Bybit e Binance: comportamento idêntico ao de hoje
- [ ] `position-sync` sincroniza as três corretoras (log mostra por corretora)
- [ ] Nenhum `current position is zero` repetido no log
- [ ] `[CREDENTIALS]` deixa de aparecer a cada 10s
- [ ] Suíte de paridade verde para as três corretoras
- [ ] Build limpo e ≥ 472 testes verdes

---

## 5. O CUSTO, SEM MAQUIAGEM

| Fase | Esforço |
|---|---|
| 1 — parar o loop | 3–5 h |
| 2 — `ResolvedStrategy` + cache | 4–6 h |
| **3 — renomear legados e corrigir ~91 pontos** | **12–18 h** |
| 4 — tipagem sem `any` | 4–6 h |
| 5 — buracos revelados | 6–10 h |
| 6 — travas | 3–4 h |
| 7 — suíte de paridade | 8–12 h |
| **Total** | **~40–60 h** |

A Fase 3 é o grosso, mas é **mecânica**: o compilador aponta cada ponto, você corrige, ele confirma. Não tem adivinhação.

**Isto resolve de uma vez?** Para esta classe de erro — corretora errada, credencial errada, caminho sem tratamento para OKX — **sim, definitivamente**, porque passa a ser impossível de escrever. Continuarão a existir bugs de lógica de trading (cálculo de TP, comportamento de buffer), mas não mais "o bot mandou a chave da OKX para a Bybit".

**A Fase 1 pode ir hoje** e já para o loop em produção. O resto pode ser faseado.

---

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_DEFINITIVO_CORRETORAS.md na raiz e execute as FASES 1 a 8, uma por
commit (a FASE 3 deve ser um commit POR ARQUIVO corrigido). EXECUTE TODAS ATÉ O
FIM. A FASE 1 é urgente — há um loop rodando em produção agora.

DIAGNÓSTICO: a migração para portfólios foi feita pela metade. A corretora e as
credenciais passaram para o Portfolio, o CredentialsResolver foi criado, MAS os
campos antigos continuam na entidade Strategy e o código anterior à migração
continua lendo eles — silenciosamente, devolvendo a corretora ERRADA.

MEDIDO AGORA: strategy.exchange/apiKey/apiSecret/isTestnet/isRealAccount aparecem
128 vezes em 16 arquivos; ~91 em serviços de produção (take-profit 22, webhook 19,
stop-loss 18, auditor 9, strategies 9, position-sync 7, user-data-stream 6,
binance-ws-init 1). PARTE está correta (recebe resolvedStrategy por parâmetro) e
PARTE está errada (lê a entidade crua) — e as duas se escrevem IGUAL, por isso
revisão manual não funciona.

QUATRO BUGS JÁ CONFIRMADOS, TODOS O MESMO: (1) getAccountBalance mandando chave da
OKX para api.bybit.com; (2) position-sync.service.ts:135 pulando OKX/Bybit por ler
strategy.exchange legado; (3) TP/SL em loop infinito como consequência;
(4) take-profit.service.ts:811 getCurrentPrice(trade, strategy: any) com
"const exchange = strategy.exchange || Exchange.BINANCE" e sem ramo para OKX — o
"any" desligou a checagem de tipos.

A CURA É ESTRUTURAL: não revisar 91 pontos com disciplina (já tentamos, escapou),
e sim fazer o COMPILADOR recusar o código errado.

FASE 1 (urgente) — tratar "current position is zero" como ESTADO TERMINAL: fechar
o trade com closeReason 'POSITION_NOT_FOUND' e excludeFromStats=true; verificar a
posição na corretora ANTES de tentar fechar; teto de 3 tentativas por trade;
POST /admin/reconcile-ghost-trades?dryRun=true para limpar os presos. NENHUM RETRY
INFINITO EM LUGAR NENHUM.

FASE 2 — criar o tipo ResolvedStrategy em common/resolved-strategy.type.ts, com
corretora e credenciais já resolvidas. CredentialsResolver.resolve() passa a
devolvê-lo completo, com cache por strategyId (TTL 30-60s, invalidado ao alterar
estratégia/portfólio) — isso também elimina o [CREDENTIALS] que hoje polui o log
a cada 10s.

FASE 3 (decisiva) — renomear as PROPRIEDADES da entidade mantendo os NOMES DAS
COLUNAS: @Column({ name: 'exchange' }) legacyExchange, @Column({ name: 'apiKey' })
legacyApiKey, etc. ZERO migração de banco. O build vai falhar em todos os pontos
errados — ESSA LISTA É A AUDITORIA COMPLETA. Corrigir um a um passando
ResolvedStrategy. Só o CredentialsResolver e o portfolio-migration.service podem
ler legacy*. Ao final, grep "legacy" fora desses dois -> zero.

FASE 4 — eliminar todo "strategy: any" dos serviços, começando por
take-profit.service.ts:811. Habilitar noImplicitAny se ainda não estiver.

FASE 5 — para cada caminho sem tratamento de OKX revelado pela tipagem: usar
exchangeFactory.get(resolved.exchange); corretora sem client -> ERRO EXPLÍCITO,
jamais fallback; remover exchangeFactory.get(Exchange.<LITERAL>) fora de
src/exchange/ salvo allowlist declarada (ex.: setTradingStop da Bybit em
position-sync:801).

FASE 6 — travas de regressão (o projeto já tem duas que funcionam): falhar se
legacy* for lido fora do resolver/migração; se aparecer "strategy: any" em
assinatura de serviço; se exchangeFactory.get( receber literal fora de
src/exchange/; se um catch de criação de SL/TP só logar sem persistir o motivo.

FASE 7 — suíte PARAMETRIZADA rodando o MESMO ciclo completo para Binance, Bybit e
OKX com clients mockados: sinal -> entrada -> SL e TP -> TP1 parcial -> SL move ->
fechamento -> PnL lido da corretora -> reconciliação. Toda corretora registrada no
factory PRECISA passar. Cenários negativos obrigatórios: posição zerada, ordem
rejeitada, credencial inválida, corretora fora do ar — nenhum pode gerar loop.

REGRAS CRÍTICAS: nenhuma fase pode ser pulada ou parcialmente aplicada — a
garantia vem de o compilador não ter brecha; Bybit e Binance mantêm comportamento
IDÊNTICO (é refatoração de tipos, não de lógica); renomear propriedade NÃO pode
alterar nome de coluna no banco.

npm run build limpo e >= 472 testes verdes ao final de cada fase.
Sem comentários em código. Liste mudanças por arquivo e o que cada teste cobre.
```
