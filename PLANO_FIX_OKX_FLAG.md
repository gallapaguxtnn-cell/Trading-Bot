# PLANO_FIX_OKX_FLAG — A OKX está pronta; a trava é que está mal desenhada

## 1. O CÓDIGO ESTÁ COMPLETO

As 8 fases do `PLANO_INTEGRACAO_OKX` foram executadas. **56 suites, 472 testes verdes, build limpo.**

```
exchange-client.interface.ts     exchange-client.factory.ts
binance-client.service.ts        bybit-exchange.client.ts
okx-client.service.ts            okx-signing.util.ts
okx-mode.util.ts                 okx-symbol.util.ts
exchange-conditional-guard.spec.ts
```

A OKX não está apagada por falta de implementação.

## 2. POR QUE A TELA FICA APAGADA

`backend/src/app.controller.ts:57`:
```ts
okxEnabled: process.env.OKX_ENABLED === 'true'
```

O frontend consome isso em `fetchPublicConfig()` e monta o select a partir do resultado. **A variável `OKX_ENABLED` não está definida no Railway**, então a API devolve `false` e a opção aparece como "(em breve)".

Não é bug: é a trava de segurança que eu mesmo especifiquei na Fase 8, para a OKX não ser liberada antes do roteiro de validação em demo.

## 3. MAS A TRAVA TEM UM DEFEITO — UM CATCH-22 ⚠️

As duas pontas discordam sobre o que a flag protege:

**Backend** — `portfolios.service.ts:113` bloqueia **apenas o modo REAL**:
```ts
if (exchange === Exchange.OKX && mode === PortfolioMode.REAL && process.env.OKX_ENABLED !== 'true')
```
Ou seja, **OKX em DEMO é permitida pelo backend mesmo com a flag desligada.** Correto.

**Frontend** — `portfolios/page.tsx:18` desabilita a **OKX inteira**:
```ts
okxEnabled
  ? { value: 'okx', label: 'OKX El Salvador' }
  : { value: 'okx', label: 'OKX El Salvador (em breve)', disabled: true }
```

**Consequência:** hoje você não consegue nem selecionar OKX para criar um portfólio **DEMO** — que é exatamente o que a Fase 7 exige antes de liberar a flag. A trava está impedindo o passo que ela própria exige.

E o contrário também é ruim: ligar `OKX_ENABLED=true` libera DEMO **e** REAL de uma vez, jogando fora a proteção justo quando ela passa a valer dinheiro de verdade.

**O correto:** o frontend deve espelhar o backend — OKX sempre selecionável, e apenas o **modo REAL** restrito pela flag.

---

## 4. A CORREÇÃO

### FASE 1 — Frontend espelha a regra do backend

`frontend/app/portfolios/page.tsx`:

1. `buildExchangeOptions` deixa de receber `okxEnabled`: **OKX El Salvador fica sempre habilitada**. BingX continua desabilitada com "(em breve)" — para ela não há client.
2. A restrição migra para o select de **Modo**: quando `exchange === 'okx'` e `okxEnabled === false`, a opção **Real** aparece desabilitada com o rótulo `Real (requer validação em demo)`. **Demo** fica sempre disponível.
3. Texto de apoio abaixo do select quando a opção Real estiver bloqueada, explicando que é preciso completar o roteiro em demo e ligar `OKX_ENABLED`.
4. Se o backend recusar mesmo assim (`assertOkxRealAllowed`), exibir a mensagem retornada — sem inventar texto próprio.

### FASE 2 — Renomear a flag para o que ela faz

`OKX_ENABLED` sugere "OKX ligada/desligada", mas o que ela controla é o modo real.

1. Renomear para **`OKX_REAL_ENABLED`**, aceitando `OKX_ENABLED` como fallback por compatibilidade.
2. Atualizar `app.controller.ts` (chave da resposta vira `okxRealEnabled`), `portfolios.service.ts`, os testes e o README.
3. Teste: com a flag desligada, portfólio OKX **DEMO** é criado normalmente; **REAL** é recusado com a mensagem correta.

### FASE 3 — Aceite

- [ ] Com a flag desligada: OKX selecionável, **Demo** disponível, **Real** desabilitada com explicação
- [ ] Portfólio OKX DEMO criado e testado com `Testar conexão`
- [ ] Com `OKX_REAL_ENABLED=true`: **Real** habilitada
- [ ] BingX segue desabilitada
- [ ] Build limpo e **≥ 472 testes verdes**

---

## 5. O QUE FAZER NO RAILWAY (depois da correção)

Enquanto valida em demo, **não precisa definir nada** — com a Fase 1 aplicada, OKX DEMO passa a funcionar sem flag.

Para liberar conta real, só depois do roteiro da Fase 7 cumprido:

```
railway variables --set OKX_REAL_ENABLED=true
railway redeploy
```

Confirmar com:
```
railway variables
curl https://<seu-backend>/public-config
```
A resposta deve trazer `"okxRealEnabled": true`.

> Lembre que a OKX distingue demo de produção **por header** (`x-simulated-trading: 1`), não por domínio. A trava da Fase 4 já valida isso a cada requisição, mas confira o log `[OKX] mode=DEMO simulated=1` na primeira ordem — é a confirmação de que está na conta certa.

---

## PROMPT PARA O CLAUDE CODE CLI

```
Leia PLANO_FIX_OKX_FLAG.md na raiz e execute as FASES 1 a 3, uma por commit.

PROBLEMA: a integração OKX está completa (56 suites, 472 testes verdes), mas a
opção continua apagada na UI porque backend e frontend discordam sobre o que a
flag OKX_ENABLED protege.

- backend (portfolios.service.ts:113, assertOkxRealEnabled) bloqueia APENAS
  exchange=OKX + mode=REAL. OKX em DEMO já é permitida sem a flag.
- frontend (portfolios/page.tsx:18, buildExchangeOptions) desabilita a OKX
  INTEIRA quando a flag está desligada.

Resultado: é impossível criar um portfólio OKX DEMO — que é exatamente o que a
FASE 7 do PLANO_INTEGRACAO_OKX exige ANTES de liberar a flag. A trava impede o
passo que ela própria exige. E ligar a flag hoje libera DEMO e REAL de uma vez,
removendo a proteção justo onde ela passa a valer dinheiro real.

CORREÇÃO: o frontend passa a espelhar a regra do backend.
- OKX El Salvador SEMPRE selecionável; BingX continua desabilitada ("em breve").
- A restrição vai para o select de MODO: com exchange=okx e a flag desligada, a
  opção "Real" fica disabled com rótulo "Real (requer validação em demo)".
  "Demo" sempre disponível.
- Renomear a flag para OKX_REAL_ENABLED (aceitar OKX_ENABLED como fallback), pois
  é o modo real que ela controla. Atualizar app.controller.ts (a chave da resposta
  vira okxRealEnabled), portfolios.service.ts, testes e README.
- Se o backend recusar, exibir a mensagem retornada por ele, sem texto inventado.

REGRAS CRÍTICAS: não afrouxar a proteção do modo REAL — ela continua valendo no
backend, que é a fonte da verdade; a UI só espelha. Não tocar no OkxClientService
nem na trava de modo DEMO/REAL da FASE 4 (x-simulated-trading), que está correta.
Bybit, Binance e BingX não mudam de comportamento.

npm run build limpo e >= 472 testes verdes ao final de cada fase.
Sem comentários em código. Liste mudanças por arquivo e o que cada teste cobre.
```
