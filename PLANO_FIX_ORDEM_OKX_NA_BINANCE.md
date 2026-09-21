# PLANO_FIX_ORDEM_OKX_NA_BINANCE — A ordem da OKX foi enviada para a Binance

## 1. A BOA NOTÍCIA PRIMEIRO

A correção do saldo funcionou:

```
[BALANCE] okx Mainnet: 10.00 USDT          ← veio da OKX, correto
[COMPOUND ON] Notional: 50.00 USDT, Quantity: 533.7319
```

## 2. O BUG: A ORDEM FOI PARA A BINANCE

Logo depois, no mesmo sinal:

```
[DEBUG] Targeting Exchange: okx (Testnet: false)
[DB] Trade created successfully: ID=75b97b82..., Status=OPEN
[executeBinanceOrder] Using Direct API for all Binance accounts     ← ❗
[POSITION MODE DETECT] Querying https://fapi.binance.com/...        ← ❗
[SymbolRulesService] [BINANCE] Failed to fetch symbol rules: 407    ← ❗
[BINANCE] Creating MARKET order                                     ← ❗
Error executing real trade: [undefined] Request failed with status code 407
```

`webhook.service.ts:2537`:
```ts
if (exchange === Exchange.BYBIT) {
  tradeDetails = await this.executeNeutralOrder(exchange, ...);   // genérico, recebe a corretora
} else {
  await this.configureBinancePositionSettings(...);               // ← OKX cai aqui
  tradeDetails = await this.executeBinanceOrder(...);             // ← executa na BINANCE
}
```

**O caminho genérico já existe.** `executeNeutralOrder(exchange, ...)` (linha 3137) recebe a corretora por parâmetro e resolve pelo factory — é exatamente o que a OKX precisa. Mas a condição só manda a Bybit para lá; **tudo que não é Bybit vai para a Binance.**

### ⚠️ Por que isso é o erro mais perigoso de toda a conversa

A ordem **só não foi executada porque o proxy da Binance devolveu 407.**

Se o proxy estivesse funcionando, o bot teria aberto uma **posição real de 50 USDT na Binance**, com as credenciais da Binance, achando que estava operando na OKX. Sem SL, sem TP, sem nenhum registro coerente.

**Foi sorte, não design.** E a sorte veio justamente do problema de proxy que ainda não corrigimos.

## 3. O SEGUNDO BUG: TRADE CRIADO ANTES DA ORDEM

```
[DB] Trade created successfully: ID=75b97b82-3572-4b12-baec-f290f1b0d380, Status=OPEN
... depois ...
Error executing real trade: 407
```

O trade é gravado no banco **antes** de a ordem existir na corretora. Quando a execução falha, sobra um trade `OPEN` sem posição nenhuma — **exatamente a fábrica de trades fantasma** que vimos alimentando o loop de TP/SL.

E o controller ainda responde `[SUCCESS] error` — log contraditório que mascara a falha.

## 4. O TERCEIRO: OKX 401 NO POSITION-SYNC

```
12:13:04  [BALANCE] okx Mainnet: 10.00 USDT              ← credencial FUNCIONA
12:15:01  [OKX AUTH ERROR] API Key is invalid or expired. Status: 401
```

A mesma credencial funciona no saldo e falha no position-sync, com dois minutos de diferença. Não é chave inválida — é **o caminho do position-sync** que está errado: outro endpoint, outra permissão, ou a passphrase não sendo repassada.

## 5. O QUARTO: AUDITOR 407 NA BYBIT VIA CCXT

```
[ExchangeService] Creating new bybit instance (Testnet: false)
[ExchangeService] [PROXY] Using proxy for bybit CCXT instance
[AuditorService] Could not fetch order ...: bybit GET https://api.bybit.com/... 407
```

A Bybit tem **dois caminhos**: o client nativo (usa `HTTP_PROXY`, funciona) e o CCXT do `ExchangeService` (usa o proxy Geonix, **407**). O auditor usa o segundo. É o mesmo problema de whitelist de destino que atingiu a OKX — `api.bybit.com` não está liberado no Geonix.

---

## 6. REGRAS

1. Sem comentários em código. `npm run build` limpo e **≥ 647 testes verdes** por fase.
2. **Nenhum caminho pode assumir Binance como padrão.** Corretora desconhecida → erro explícito.
3. **Nenhum trade gravado como `OPEN` sem ordem confirmada na corretora.**
4. Bybit e Binance mantêm comportamento idêntico.

## FASE 1 — A ORDEM VAI PARA A CORRETORA CERTA (urgente)

`webhook.service.ts:2537`:

1. Inverter a lógica: **Binance** é o caso específico, todo o resto usa o caminho genérico:
   ```
   if (exchange === Exchange.BINANCE) { ...configureBinancePositionSettings + executeBinanceOrder... }
   else { ...executeNeutralOrder(exchange, ...)... }
   ```
   Ou, melhor: mover a Binance também para `executeNeutralOrder` e deixar as particularidades dentro do `BinanceClient`.
2. Corretora sem client registrado → **lançar erro explícito**, jamais cair na Binance.
3. Teste: estratégia OKX → `executeNeutralOrder` com `Exchange.OKX`; **nenhuma** chamada a `fapi.binance.com`.
4. Varrer o arquivo inteiro por outros `else` que assumem Binance — este é o mesmo padrão do `getAccountBalance`.

## FASE 2 — TRADE SÓ NASCE DEPOIS DA ORDEM CONFIRMADA

1. Reordenar: **executar a ordem primeiro**, e só gravar o trade quando a corretora confirmar (com `exchangeOrderId`).
2. Se a execução falhar, **nenhum** registro `OPEN` fica no banco — apenas o `signal_log` com a decisão e o motivo.
3. Se a ordem executar mas a gravação falhar, é o caso inverso e mais grave: logar em `error` com todos os dados da ordem e emitir alerta, para reconciliação manual. **Nunca perder silenciosamente uma posição aberta.**
4. Corrigir o `[SUCCESS] error` do controller: falha de execução responde erro coerente, não "SUCCESS".
5. Teste: ordem rejeitada pela corretora → zero trades no banco.

## FASE 3 — POSITION-SYNC DA OKX

1. Investigar por que a mesma credencial funciona em `getWalletBalance` e falha no sync. Verificar se o caminho do sync repassa a **passphrase** e a **região**, e qual endpoint chama.
2. Se for permissão da chave, a mensagem deve dizer **qual** permissão falta — não "API Key is invalid or expired", que mandou você trocar uma chave que estava certa.
3. Teste: credencial válida → sync sem erro; sem passphrase → mensagem específica.

## FASE 4 — O CCXT DO AUDITOR TAMBÉM FORA DO PROXY

1. `exchange.service.ts` (CCXT) passa a respeitar `PROXY_EXCHANGES`, igual ao `ProxyUtil` — é a mesma correção, aplicada ao caminho que faltou.
2. Com `PROXY_EXCHANGES=binance`, o CCXT da Bybit e da OKX conecta direto e o 407 do auditor some.
3. Teste: CCXT da Bybit não usa proxy quando fora da lista.

## FASE 5 — TRAVA CONTRA ESTE PADRÃO

O guarda da Fase 6 do plano anterior pegou `exchangeFactory.get(Exchange.LITERAL)`, mas **não pegou este caso** — aqui não há factory, há uma chamada direta a um método específico de corretora.

1. Teste que falha se um método com nome de corretora (`executeBinanceOrder`, `configureBinancePositionSettings`, etc.) for chamado fora de um bloco que já filtrou aquela corretora explicitamente.
2. Alternativa mais robusta: tornar esses métodos **privados do respectivo client** e expor só a interface genérica — aí o padrão deixa de compilar.

## FASE 6 — ACEITE

- [ ] Sinal OKX: **nenhuma** menção a `fapi.binance.com` ou `executeBinanceOrder` no log
- [ ] Ordem rejeitada → **zero** trades `OPEN` no banco
- [ ] Controller não responde `[SUCCESS] error`
- [ ] Position-sync da OKX sem 401
- [ ] Auditor sem 407 na Bybit
- [ ] Binance e Bybit inalteradas
- [ ] Build limpo e ≥ 647 testes verdes

---

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_FIX_ORDEM_OKX_NA_BINANCE.md na raiz e execute as FASES 1 a 6, uma por
commit. EXECUTE TODAS ATÉ O FIM. A FASE 1 é CRÍTICA.

BUG CRÍTICO: webhook.service.ts:2537
  if (exchange === Exchange.BYBIT) { executeNeutralOrder(exchange, ...) }
  else { configureBinancePositionSettings(...); executeBinanceOrder(...) }
A OKX cai no ELSE e a ordem é enviada para a BINANCE. Confirmado em produção:
"[DEBUG] Targeting Exchange: okx" seguido de "[executeBinanceOrder] Using Direct
API", "[POSITION MODE DETECT] Querying https://fapi.binance.com/..." e
"[BINANCE] Creating MARKET order".

A ordem SÓ NÃO EXECUTOU porque o proxy da Binance devolveu 407. Com o proxy
funcionando, o bot teria aberto uma posição REAL de 50 USDT na Binance achando
que era OKX. O caminho genérico executeNeutralOrder(exchange, ...) (linha 3137) JÁ
EXISTE e recebe a corretora por parâmetro — só a Bybit é roteada para ele.

FASE 1 — inverter: Binance vira o caso específico e todo o resto usa
executeNeutralOrder; ou melhor, mover a Binance também para o caminho genérico e
deixar as particularidades dentro do BinanceClient. Corretora sem client
registrado -> ERRO EXPLÍCITO, jamais cair na Binance. Varrer o arquivo por outros
else que assumem Binance (mesmo padrão do getAccountBalance já corrigido).

FASE 2 — o trade é gravado no banco com Status=OPEN ANTES de a ordem existir na
corretora ("[DB] Trade created successfully" e depois "Error executing real
trade: 407"), criando trades fantasma — a mesma fábrica que alimentou o loop de
TP/SL. Reordenar: executar a ordem PRIMEIRO, gravar o trade só com
exchangeOrderId confirmado. Falha de execução -> ZERO registro OPEN, apenas
signal_log. Ordem executada mas gravação falhou -> logger.error com todos os
dados + alerta para reconciliação manual, nunca perder uma posição em silêncio.
Corrigir o "[SUCCESS] error" do controller.

FASE 3 — position-sync da OKX devolve "[OKX AUTH ERROR] API Key is invalid or
expired. Status: 401" a cada 5 min, MAS a mesma credencial funcionou em
"[BALANCE] okx Mainnet: 10.00 USDT" dois minutos antes. Não é chave inválida:
investigar se o caminho do sync repassa passphrase e região, e qual endpoint
chama. A mensagem deve dizer qual permissão falta, não mandar trocar uma chave
que está certa.

FASE 4 — exchange.service.ts (CCXT) deve respeitar PROXY_EXCHANGES igual ao
ProxyUtil. O auditor usa CCXT e recebe 407 na Bybit ("[PROXY] Using proxy for
bybit CCXT instance" -> "407 Proxy Authentication Required"), porque api.bybit.com
não está na whitelist do Geonix. A Bybit nativa usa HTTP_PROXY e funciona; só o
caminho CCXT ficou de fora.

FASE 5 — o guard existente pega exchangeFactory.get(Exchange.LITERAL) mas NÃO
pegou este caso, que é chamada direta a método específico de corretora. Adicionar
trava: método com nome de corretora chamado fora de bloco que filtrou aquela
corretora -> falha. Alternativa melhor: tornar esses métodos privados do client e
expor só a interface genérica, para o padrão não compilar.

REGRAS CRÍTICAS: NENHUM caminho pode assumir Binance como padrão — corretora
desconhecida gera erro explícito; NENHUM trade gravado como OPEN sem ordem
confirmada na corretora; Bybit e Binance mantêm comportamento idêntico.

npm run build limpo e >= 647 testes verdes ao final de cada fase.
Sem comentários em código. Liste mudanças por arquivo e o que cada teste cobre.
```
