# PLANO_FIX_PROXY_407_OKX — Tirar a OKX do proxy e conectar direto

## 1. O DIAGNÓSTICO, FECHADO

Três mecanismos de proxy coexistem no bot:

| Corretora | Variável | Mecanismo | Resultado |
|---|---|---|---|
| Binance | `GEONIX_PROXY_*` | `HttpsProxyAgent` (`binance-request.util.ts:6`) | ✅ |
| **OKX** | **`GEONIX_PROXY_*`** | **`HttpsProxyAgent`** (`okx-request.util.ts:6`) | ❌ **407** |
| Bybit | `HTTP_PROXY` | `config.proxy` nativo do axios (`bybit-client.service.ts:75`) | ✅ |

As duas primeiras linhas são **idênticas** — mesmo proxy, mesmo código, mesma credencial. A única variável é o destino: `fapi.binance.com` passa, `www.okx.com` leva 407.

Proxies ISP são vendidos com whitelist de destinos. `binance.com` está no plano contratado; `okx.com` não. Vários provedores devolvem **407** para destino não autorizado, em vez de 403 — daí o erro parecer problema de senha.

**Decisão:** a OKX passa a conectar **direto**, sem proxy. O proxy existe para contornar bloqueio geográfico da Binance; a OKX El Salvador é a entidade offshore feita justamente para atender brasileiros e não precisa dele.

## 2. O QUE A DOCUMENTAÇÃO OFICIAL DIZ (e o que importa aqui)

**⚠️ O ponto que pode travar tudo: IP whitelist na API Key.**

A OKX permite (opcionalmente) restringir a API Key a IPs específicos. **Se a sua chave foi criada com whitelist apontando para o IP do proxy Geonix, tirar o proxy vai quebrá-la** — a conexão passará a sair pelo IP do Railway e a OKX recusará.

Antes de qualquer coisa, abra a sua API Key no painel da OKX e verifique:
- **Sem IP whitelist** → pode seguir, funciona direto
- **Com IP whitelist** → ou remova a restrição, ou adicione o IP de saída do Railway (a Fase 3 deste plano cria um endpoint que mostra esse IP)

O sintoma de chave com IP errado é o código **50110**.

**Rate limits** (relevante porque muda a natureza do limite ao sair do proxy):
- **Endpoints públicos** (`/api/v5/public/instruments`) → limitados **por IP**, ~20 req/2s
- **Endpoints privados** (`/api/v5/account/balance`) → limitados **por UserID**, 6 req/2s
- Teto global de 500 req/2s

Sair do proxy muda o IP de origem dos endpoints públicos. Com o volume do bot isso é irrelevante, mas o `SymbolRulesService` já cacheia `instruments` por 1h, o que mantém o consumo baixo.

**Domínio:** `www.okx.com` para conta global/El Salvador. `eea.okx.com` (UE) e `us.okx.com` (EUA) só para essas entidades. O `okxBaseUrl()` em `okx-client.service.ts:22` já trata isso pela `region`.

---

## 3. REGRAS

1. Sem comentários em código. `npm run build` limpo e **≥ 472 testes verdes** por fase.
2. **Não tocar no proxy da Binance nem no da Bybit.** As duas funcionam.
3. **Não remover as variáveis `GEONIX_PROXY_*`** — a Binance depende delas.
4. Nenhuma credencial de proxy em log, nem parcialmente mascarada.

## FASE 1 — PROXY SELETIVO POR CORRETORA

1. Nova variável **`PROXY_EXCHANGES`** — lista de corretoras que saem pelo proxy Geonix. Default **`binance`**: preserva exatamente o que funciona e deixa a OKX direto.
2. `ProxyUtil.getAxiosConfig(exchange)` passa a receber a corretora. Fora da lista → devolve `{}` (conexão direta).
3. `OkxRequestUtil` e `BinanceRequestUtil` informam sua corretora na chamada.
4. A Bybit **não entra na lista e não é tocada** — usa o caminho próprio via `HTTP_PROXY`.
5. Log no boot: `[PROXY] Geonix ativo para: binance | direto: okx | bybit usa HTTP_PROXY`.
6. Testes: com o default, OKX vai direto e Binance vai pelo proxy; com `PROXY_EXCHANGES=binance,okx`, a OKX volta ao proxy; sem a variável, comportamento atual da Binance intacto.

> Se um dia a OKX precisar do proxy (bloqueio regional), basta `PROXY_EXCHANGES=binance,okx` — sem deploy.

## FASE 2 — DIAGNÓSTICO DE CONEXÃO QUE NÃO MENTE

O log atual (`Request failed with status code 407`) parecia credencial inválida da OKX e custou tempo de diagnóstico.

1. Em `portfolios.service.ts` (`test-connection`) e no tratamento de erro dos clients, classificar e devolver mensagem específica, **exibida na tela do portfólio**:
   - **407 / 502 / 503 de proxy** → `"Falha no PROXY — a requisição não chegou na corretora. Verifique PROXY_EXCHANGES ou a whitelist do provedor."`
   - **`ECONNREFUSED` / `ETIMEDOUT`** → `"Não foi possível alcançar a corretora (rede)."`
   - **OKX `50110`** → `"API Key com IP whitelist: o IP de saída atual não está autorizado na OKX. Remova a restrição na chave ou adicione o IP do servidor."`
   - **OKX `50111` / `50112` / `50113`** → assinatura, timestamp ou passphrase inválidos, cada um com sua mensagem.
2. Nunca reportar erro de rede ou proxy como credencial inválida da corretora.

## FASE 3 — MOSTRAR O IP DE SAÍDA

Necessário para configurar a whitelist da OKX quando você quiser manter a restrição.

1. `GET /admin/egress-ip`: consulta um serviço público de eco de IP **sem proxy** e devolve o IP de saída do servidor.
2. Exibir esse IP na tela de Configurações, com a nota de que é ele que deve entrar na whitelist da API Key da OKX.
3. Cachear por 10 minutos. Se a consulta falhar, devolver erro claro em vez de IP vazio.

## FASE 4 — TESTE DE CONEXÃO EM DUAS ETAPAS

Hoje o `test-connection` só chama o endpoint privado. Quando falha, não dá para saber se o problema é rede ou credencial.

1. Primeiro chamar o **endpoint público** `/api/v5/public/instruments?instType=SWAP&instId=<símbolo>` — não exige autenticação. Se falhar: problema de **rede/proxy**, e a mensagem diz isso.
2. Só então chamar o **privado** `/api/v5/account/balance`. Se o público passou e o privado falhou: problema de **credencial** (chave, passphrase, whitelist de IP ou permissão).
3. Devolver também `ctVal`, `ctMult`, `lotSz`, `minSz` e `tickSz` do instrumento — os números que confirmam a conversão de contratos antes da primeira ordem.

## FASE 5 — ROBUSTEZ DO PROXY (bug latente, não era a causa)

`proxy.util.ts:24` monta a URL por interpolação sem encoding:
```ts
`http://${geonixUser}:${geonixPass}@${geonixHost}:${geonixHttpPort}`
```
Não causou este 407 — mas quebraria a **Binance** no dia em que você trocasse a senha do Geonix por uma com `@`, `#` ou `%`.

1. Aplicar `encodeURIComponent` em usuário e senha nas duas URLs (HTTP e SOCKS).
2. Teste com senha contendo `@ : # % /`.

## FASE 6 — ACEITE

- [ ] Log de boot: `[PROXY] Geonix ativo para: binance | direto: okx`
- [ ] `Testar conexão` na OKX retorna saldo, sem 407
- [ ] Binance e Bybit continuam conectando (sem regressão)
- [ ] `test-connection` distingue falha de rede de falha de credencial
- [ ] `/admin/egress-ip` devolve o IP de saída
- [ ] `test-connection` devolve `ctVal`, `lotSz`, `minSz`, `tickSz`
- [ ] Senha de proxy com caractere especial funciona (Binance)
- [ ] Build limpo e ≥ 472 testes verdes

---

## 4. DEPOIS DO DEPLOY

Nada a configurar — o default `PROXY_EXCHANGES=binance` já deixa a OKX direto.

Se quiser ser explícito no Railway:
```
railway variables --set PROXY_EXCHANGES=binance
railway redeploy
```

**Antes de testar**, confira no painel da OKX se a API Key tem **IP whitelist**. Se tiver, ou remova a restrição, ou pegue o IP em `/admin/egress-ip` e adicione lá. É a única coisa que pode fazer a conexão direta falhar depois desta correção.

---

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_FIX_PROXY_407_OKX.md na raiz e execute as FASES 1 a 6, uma por commit.
EXECUTE TODAS ATÉ O FIM.

CONTEXTO: "Request failed with status code 407" no test-connection da OKX.
407 = Proxy Authentication Required — a requisição NÃO chegou na OKX. Confirmado
pelo usuário: Bybit e Binance funcionam, SÓ a OKX falha.

DIAGNÓSTICO FECHADO: binance-request.util.ts:6 e okx-request.util.ts:6 chamam
AMBOS ProxyUtil.getAxiosConfig() — mesmo proxy Geonix, mesmo HttpsProxyAgent,
mesma credencial. A Binance passa e a OKX leva 407, então a variável é o DESTINO:
o proxy ISP tem whitelist de domínios e okx.com não está liberado (vários
provedores devolvem 407 em vez de 403 para destino não autorizado). Isso ELIMINA
a hipótese de senha malformada — se a URL estivesse quebrada, a Binance falharia
junto. A Bybit é um TERCEIRO mecanismo: bybit-client.service.ts:55 lê HTTP_PROXY
(não o Geonix) e usa config.proxy nativo do axios.

DECISÃO: a OKX passa a conectar DIRETO, sem proxy.

FASE 1 — criar PROXY_EXCHANGES (lista de corretoras que usam o proxy GEONIX),
default "binance". ProxyUtil.getAxiosConfig passa a receber a corretora; fora da
lista devolve {} (direto). OkxRequestUtil e BinanceRequestUtil informam sua
corretora. A Bybit NÃO entra na lista e NÃO é tocada. Log no boot:
"[PROXY] Geonix ativo para: binance | direto: okx | bybit usa HTTP_PROXY".

FASE 2 — classificar erros de conexão e exibir NA TELA do portfólio, nunca como
credencial inválida: 407/502/503 de proxy -> erro de PROXY; ECONNREFUSED/
ETIMEDOUT -> erro de rede; OKX 50110 -> "API Key com IP whitelist: o IP de saída
atual não está autorizado na OKX"; OKX 50111/50112/50113 -> assinatura, timestamp
e passphrase, cada um com sua mensagem.

FASE 3 — GET /admin/egress-ip: consulta um serviço público de eco de IP SEM proxy
e devolve o IP de saída do servidor, cacheado por 10 min, exibido em Configurações.
É o IP que o usuário precisa cadastrar na whitelist da API Key da OKX.

FASE 4 — test-connection em DUAS ETAPAS: primeiro o endpoint PÚBLICO
/api/v5/public/instruments?instType=SWAP&instId=<simbolo> (sem autenticação) —
se falhar, o problema é REDE/PROXY; só então o PRIVADO /api/v5/account/balance —
se o público passou e o privado falhou, o problema é CREDENCIAL (chave,
passphrase, IP whitelist ou permissão). Devolver também ctVal, ctMult, lotSz,
minSz e tickSz do instrumento.

FASE 5 — aplicar encodeURIComponent em usuário e senha nas duas URLs (HTTP e
SOCKS) de proxy.util.ts:24. NÃO foi a causa deste 407, mas quebraria a BINANCE
numa futura troca de senha com @ # ou %.

REGRAS CRÍTICAS: NÃO tocar no proxy da Binance nem no da Bybit — as duas
funcionam; NÃO remover as variáveis GEONIX_PROXY_*, a Binance depende delas;
nenhuma credencial de proxy em log, nem parcialmente mascarada; rate limits da
OKX são por IP nos endpoints públicos e por UserID nos privados — manter o cache
de 1h de instruments que o SymbolRulesService já faz.

npm run build limpo e >= 472 testes verdes ao final de cada fase.
Sem comentários em código. Liste mudanças por arquivo e o que cada teste cobre.
```

---

**Fontes:**
- [OKX API guide v5](https://www.okx.com/docs-v5/en/)
- [OKX API FAQ](https://www.okx.com/en-us/help/api-faq)
- [Third Party App IP Whitelist Launch](https://www.okx.com/en-us/help/third-party-app-ip-whitelist-launch)
