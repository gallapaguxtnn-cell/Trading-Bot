# PLANO_FIX_BYBIT_SITE_ID — Conta internacional Brasil exige header `x-site-id`

## O QUE MUDOU NA BYBIT

A Bybit está migrando usuários residentes no Brasil para uma **entidade local** (Bybit Brasil), com restrição de derivativos, margem e bots. Quem quer continuar operando futuros passa a usar a **conta internacional** (a aba "Conta internacional" no seletor de contas).

A documentação oficial da API é explícita:

> **Brazil users**: For Brazil international account, use `api.bybit.com`, add `x-site-id`: **BRA_BTL** in the request header

Ou seja: o domínio continua `api.bybit.com`, mas **sem o header `x-site-id` a Bybit não resolve a chave para a entidade internacional** e responde `API key is invalid` (retCode 10003) — exatamente o erro dos logs.

## CAUSA RAIZ NO CÓDIGO (confirmada)

`backend/src/exchange/bybit-client.service.ts` → `getHeaders()` monta apenas:

```ts
'X-BAPI-API-KEY', 'X-BAPI-SIGN', 'X-BAPI-TIMESTAMP', 'X-BAPI-RECV-WINDOW', 'Content-Type'
```

**Não existe `x-site-id` em lugar nenhum do projeto.** Como `getHeaders()` é o único ponto que monta headers autenticados da Bybit (todos os métodos passam por ele), a correção é centralizada.

`getBaseUrl()` retorna `api.bybit.com` no mainnet — **isso está correto** para o Brasil internacional, não precisa mudar.

## REGRAS

1. Sem comentários em código. `npm run build` + testes verdes por fase.
2. Não mudar assinatura de método público na Fase 1 (correção de menor risco primeiro).
3. Não alterar a lógica de assinatura HMAC — o `x-site-id` **não entra** no payload assinado, é só header de roteamento.

---

## VALIDAÇÃO RÁPIDA (antes de qualquer deploy)

Rodar localmente para confirmar a hipótese em 1 minuto. Salvar como `test-site-id.js` na raiz do backend e executar com `node test-site-id.js`:

```js
const crypto = require('crypto');
const KEY = 'SUA_API_KEY';
const SECRET = 'SEU_API_SECRET';
const SITE_ID = 'BRA_BTL';

async function call(withSiteId) {
  const ts = Date.now().toString();
  const recv = '5000';
  const qs = 'accountType=UNIFIED';
  const sign = crypto.createHmac('sha256', SECRET).update(ts + KEY + recv + qs).digest('hex');
  const headers = {
    'X-BAPI-API-KEY': KEY,
    'X-BAPI-SIGN': sign,
    'X-BAPI-TIMESTAMP': ts,
    'X-BAPI-RECV-WINDOW': recv,
  };
  if (withSiteId) headers['x-site-id'] = SITE_ID;
  const r = await fetch(`https://api.bybit.com/v5/account/wallet-balance?${qs}`, { headers });
  const j = await r.json();
  console.log(withSiteId ? 'COM x-site-id:' : 'SEM x-site-id:', j.retCode, j.retMsg);
}

call(false).then(() => call(true));
```

Esperado: **sem** o header → `10003 API key is invalid`; **com** o header → `0 OK`. Se os dois falharem, o problema é outro (ver seção final).

---

## FASE 1 — CORREÇÃO MÍNIMA (env global, desbloqueia hoje)

`bybit-client.service.ts`:

1. Ler `BYBIT_SITE_ID` do `ConfigService` (ou `process.env`) no construtor, guardando em `private readonly siteId: string | null`.
2. Em `getHeaders()`, se `siteId` estiver definido, acrescentar `'x-site-id': this.siteId` ao objeto retornado. Nenhuma outra mudança — a assinatura HMAC continua idêntica.
3. Log no boot: `[BYBIT] site-id ativo: BRA_BTL` ou `[BYBIT] sem site-id (conta padrão)`, para ficar visível no Railway.
4. Configurar no Railway: `BYBIT_SITE_ID=BRA_BTL`. Redeploy.
5. Teste unitário: `getHeaders` com env definida inclui o header; sem env, o objeto é idêntico ao atual (garante zero regressão para quem usa conta padrão).

## FASE 2 — POR ESTRATÉGIA (flexibilidade, sem pressa)

Necessária se você for operar contas de entidades diferentes ao mesmo tempo (ex.: uma conta padrão e uma internacional).

1. Coluna aditiva nullable em `strategy.entity.ts`: `bybitSiteId: string | null` (valores: `null` = conta padrão, `BRA_BTL`, `ARG_BTL`, ou outro que a Bybit publique).
2. Adicionar parâmetro **opcional no fim** das assinaturas do `bybit-client.service.ts` (`siteId?: string`) e repassar até `getHeaders`. Opcional no fim = nenhuma chamada existente quebra.
3. `webhook.service.ts`, `take-profit.service.ts`, `position-sync.service.ts`, `auditor.service.ts`: passar `strategy.bybitSiteId` nas chamadas ao client. Precedência: valor da estratégia → env `BYBIT_SITE_ID` → nenhum.
4. UI do bot: select "Entidade Bybit" na edição da estratégia (Padrão / Brasil internacional / Argentina internacional), visível só quando `exchange === 'bybit'`.
5. Testes: estratégia com `BRA_BTL` envia o header; sem valor cai na env; sem nenhum, comportamento atual.

## FASE 3 — MENSAGEM DE ERRO ÚTIL

`bybit-client.service.ts`: ao receber `retCode 10003` (`API key is invalid`), acrescentar ao erro uma dica acionável:
`"API key inválida. Se a conta é internacional (Brasil/Argentina), verifique se BYBIT_SITE_ID/bybitSiteId está configurado — a Bybit exige o header x-site-id para essas contas."`
Isso evita perder horas no mesmo diagnóstico no futuro.

---

## SE O ERRO PERSISTIR COM O HEADER CORRETO

Checar nesta ordem:

1. **A chave foi criada na conta certa?** No print há a conta principal (9,99 USD) e duas subcontas com 0 USD. Cada subconta tem chave própria — a chave precisa ser da conta que vai operar.
2. **A chave foi criada na aba "Conta internacional"?** Chave gerada na conta padrão não vale para a internacional, e vice-versa.
3. **Whitelist de IP**: se a chave tem IP restrito, o IP do Railway precisa estar na lista. (Erro típico seria `10010`, mas vale conferir.)
4. **Permissões**: a chave precisa de leitura de conta + trade de derivativos.
5. **`isTestnet`**: se a estratégia estiver marcada como testnet, o bot chama `api-testnet.bybit.com` e a chave de produção nunca vai funcionar.
6. **KYC nível 2**: a Bybit passou a exigir para brasileiros; sem isso, derivativos ficam bloqueados na conta.

## PRAZOS DA MIGRAÇÃO (atenção)

- A partir de **04/08/2026** a Bybit começou a pedir atualização/verificação de identidade para brasileiros, com prazo até **21/08/2026**.
- A partir de **21/09/2026**, posições em derivativos/margem incompatíveis com a oferta da Bybit Brasil passam a ser **encerradas pela própria plataforma**.

Vale confirmar em qual entidade cada estratégia vai operar antes dessa data, para não ter posição fechada à revelia.

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_FIX_BYBIT_SITE_ID.md na raiz e execute a FASE 1 e a FASE 3.
CONTEXTO: a conta internacional Brasil da Bybit exige o header x-site-id: BRA_BTL
em api.bybit.com — sem ele a API responde "API key is invalid". O projeto não
envia esse header em lugar nenhum.
REGRAS CRÍTICAS: o x-site-id NÃO entra no payload assinado (HMAC inalterado);
sem a env BYBIT_SITE_ID os headers devem ficar idênticos aos de hoje (zero
regressão para conta padrão); não mudar getBaseUrl. Sem comentários em código.
npm run build + testes verdes. Liste mudanças por arquivo.
```

Executar a FASE 2 depois, só se precisar operar entidades diferentes ao mesmo tempo.
