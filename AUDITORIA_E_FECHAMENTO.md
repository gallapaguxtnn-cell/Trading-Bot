# AUDITORIA GERAL — O que foi resolvido e os 3 gaps que sobraram

Revisão de tudo que você reportou desde o início, conferido contra o código atual (`a3484a0`).
**Build limpo. 45 suites, 320 testes verdes.**

---

## 1. VEREDICTO: SIM, FAZ SENTIDO — E O CONJUNTO É COERENTE

Olhando os planos em conjunto, e não um a um, aparece um fio condutor: **quase todos os seus erros tinham a mesma raiz — o bot decidia com base no que ele *achava* que tinha acontecido, em vez do que a corretora *disse* que aconteceu.**

| Sintoma que você reportou | O que o bot fazia | O que faz agora |
|---|---|---|
| TP de 0,30% saindo 0,427% | calculava sobre o preço do **sinal** | usa o preço de **preenchimento real** |
| SL de 2% fechando em 0,69% | ancorava no sinal e nunca recalculava no fill | recalcula e **reposiciona** quando o fill diverge |
| PnL −0,49 vs −0,3050 na corretora | calculava com fórmula local, sem taxas | lê o **fill real** (`fetchOrderFill` + `tpPnl`) |
| TPs "desativando" | quantidade fora do `qtyStep` → corretora rejeitava | `planTakeProfits` com fatias válidas e soma exata |
| Trades duplicados, ordens penduradas | fechava por cálculo local; resíduo virava "órfã" importada | confirma posição na corretora antes de fechar |
| TP saindo a Market | fallback de software assumia em silêncio | só após N tentativas, com `TAKE_PROFIT_FALLBACK_MARKET` |
| "API key is invalid" | faltava o header `x-site-id` | header implementado |
| Buffer cancelando cedo | expirava por tempo | só por sinal contrário / pausa / cancelamento |

Essa é a razão de os erros parecerem não acabar: **eram a mesma doença em órgãos diferentes.** O `PLANO_FIX_ARREDONDAMENTO_GLOBAL` foi o que atacou a causa estrutural — extraiu a precisão para `common/exchange-precision.util.ts` e criou um teste que **falha se `toFixed(` voltar a aparecer em parâmetro de ordem**. É a única correção que impede a categoria inteira de voltar.

### Verificado empiricamente, não só por commit

- `resolveProtectionPrice` não depende mais de `isLimitOrder` — usa o fill sempre que existe
- Teste do caso real: *"SL desalinhado (SUIUSDT: SL 0.8015 vs alvo 0.81192 sobre o fill 0.796) → cria o novo antes de cancelar o antigo"*
- Teste do PnL: *"SL preenchido a 0.8015 (entry 0.796, 50 SUI, taxa 0.030) → PnL exatamente −0.3050, lido da corretora"*
- `planTakeProfits` com quantidade fracionária real: `1789,98 → 590/590/609`, todas múltiplas do step
- Portfólio integrado ponta a ponta: `trade.portfolioId` preenchido nos 3 pontos de criação, migração de backfill, `performance` excluindo `excludeFromStats`

### A implementação do portfólio está completa

| Página | Estado |
|---|---|
| Portfólios | 323 linhas — CRUD, modal, teste de conexão |
| Dashboard | 504 linhas, 11 referências a portfólio (filtro ativo) |
| Estratégias | 672 linhas, 13 referências (select de portfólio) |
| Desempenho | 220 linhas |
| Avisos | 145 linhas |

---

## 2. OS TRÊS GAPS QUE SOBRARAM

### GAP A — O plano do SL parou na Fase 4 (baixo risco, mas incompleto)

O último commit é `FASE 4`. Faltaram:
- **Fase 5** — UI mostrando **os dois tempos** (`Pendente: 22h11m` / `Em posição: 29m`) e `Sinal → Fill`. Sem isso, você continuará achando que bot e corretora mostram operações diferentes. Foi exatamente o que gerou sua dúvida.
- **Fase 7** — roteiro de aceite.
- A **Fase 6** (`SL_PERCENT_MISMATCH`) já estava coberta por um plano anterior — verifiquei, está ativa no auditor.

### GAP B — O `x-site-id` continua global, mas agora existem vários portfólios ⚠️

Este é o gap de integração mais importante, e nasceu justamente do cruzamento de dois planos.

O `BYBIT_SITE_ID` é lido de **variável de ambiente, uma só para todo o bot**. A Fase 2 daquele plano (site-id por estratégia) nunca foi executada — na época não era necessário.

**Com portfólios, virou necessário.** Se você cadastrar um portfólio da **conta internacional Brasil** (`BRA_BTL`) e outro da **conta padrão** Bybit, os dois vão usar o mesmo header. Um dos dois falha com **"API key is invalid"** — exatamente o erro original voltando, agora intermitente e difícil de diagnosticar.

`portfolio.entity.ts` não tem campo de site-id, e o `CredentialsResolver` não o repassa.

### GAP C — O reset pode deixar ordem órfã viva na corretora ⚠️

O reset bloqueia se houver trade `OPEN` — correto. Mas ele **apaga trades `ERROR` e `CLOSED` sem verificar se ainda existe ordem viva na corretora**.

Cenário real: uma ordem LIMIT com buffer passa dos 60 min, o monitor a transfere ao position-sync, e por algum motivo o trade termina em `ERROR` com a ordem ainda no book. O reset apaga o registro. **Dias depois a ordem preenche** — e agora existe uma posição real, com dinheiro, sem trade associado, sem SL e sem TP. Ninguém a monitora.

A probabilidade é moderada; a consequência é grave. E ficou maior desde que o buffer deixou de expirar.

---

## 3. PLANO DE FECHAMENTO

### FASE 1 — Site-id por portfólio (GAP B)

1. Coluna aditiva nullable `bybitSiteId: string | null` em `portfolio.entity.ts` (`null` = conta padrão; `BRA_BTL`, `ARG_BTL`, …).
2. `CredentialsResolver` passa a devolver `siteId` junto das credenciais. Precedência: **portfólio → env `BYBIT_SITE_ID` → nenhum**.
3. `bybit-client.service.ts`: aceitar `siteId` como parâmetro **opcional no fim** das assinaturas e repassar ao `getHeaders`. Opcional no fim = nenhuma chamada existente quebra. Sem `siteId`, os headers ficam idênticos aos de hoje.
4. UI do portfólio: select **"Entidade Bybit"** (Padrão / Brasil internacional / Argentina internacional), visível só quando a corretora for Bybit.
5. Testes: portfólio com `BRA_BTL` envia o header; sem valor cai na env; sem nenhum, comportamento atual. **Dois portfólios de entidades diferentes na mesma instância funcionam simultaneamente.**

### FASE 2 — Reset verifica a corretora (GAP C)

1. Antes de apagar, para cada trade com `exchangeOrderId`, consultar a corretora e verificar se a ordem ainda está viva (`New`, `PartiallyFilled`, `Untriggered`).
2. Se houver **qualquer** ordem viva: **recusar** o reset, listando símbolo, `orderId` e status. Mesmo tratamento dado ao trade `OPEN`.
3. Oferecer `?cancelOrphanOrders=true` que **cancela as ordens na corretora antes** de apagar — com confirmação explícita e log de cada cancelamento.
4. Incluir a lista de ordens vivas no retorno do `dryRun`, para você ver antes de decidir.
5. Testes: reset com ordem `New` na corretora → recusado; com `cancelOrphanOrders` → cancela, registra e prossegue.

### FASE 3 — UI dos dois tempos (GAP A / Fase 5 pendente)

1. Card do trade exibe `Pendente: 22h11m` e `Em posição: 29m` separados.
2. Mostrar `Sinal: 0.7858 → Fill: 0.796` quando houver divergência, com o percentual.
3. Badge quando `protectionRepricedAt` estiver preenchido ("SL reposicionado após o fill").
4. Exibir o SL efetivo em % sobre a entrada real, ao lado do configurado.

### FASE 4 — Aceite ponta a ponta

- [ ] Dois portfólios Bybit de entidades diferentes operando ao mesmo tempo, sem "API key is invalid"
- [ ] Ordem com buffer que preenche horas depois: SL efetivo = **2%** sobre o preço de preenchimento
- [ ] PnL do card idêntico ao `Closed P&L` da Bybit
- [ ] Card mostra tempo pendente e tempo em posição separados
- [ ] `dryRun` do reset lista ordens vivas na corretora; reset recusa enquanto existirem
- [ ] Auditoria sem `SL_PERCENT_MISMATCH`, `TP_PERCENT_MISMATCH` nem `MISSING_TP_ORDERS` nos trades novos

---

## PROMPT PARA O CLAUDE CODE CLI

```
Leia AUDITORIA_E_FECHAMENTO.md na raiz e execute as FASES 1 a 4, uma por commit.
EXECUTE TODAS ATÉ O FIM — não pare no meio.

CONTEXTO: auditoria geral do bot encontrou o conjunto coerente e funcionando
(45 suites, 320 testes verdes, build limpo), com TRÊS gaps remanescentes. Dois
deles nasceram do cruzamento entre planos que foram escritos separadamente.

GAP B (FASE 1) — o header x-site-id da Bybit é lido de uma ÚNICA variável de
ambiente global (BYBIT_SITE_ID), mas o sistema agora tem MÚLTIPLOS portfólios.
Se um portfólio for da conta internacional Brasil (BRA_BTL) e outro da conta
padrão, ambos usarão o mesmo header e um dos dois falhará com "API key is
invalid" — o erro original voltando de forma intermitente. portfolio.entity.ts
não tem campo de site-id e o CredentialsResolver não o repassa.

GAP C (FASE 2) — admin.service.ts bloqueia o reset se houver trade OPEN, mas
apaga trades ERROR e CLOSED SEM verificar se ainda existe ordem viva na
corretora. Uma ordem LIMIT com buffer pode continuar no book após o trade ir
para ERROR; apagado o registro, ela pode preencher dias depois e virar uma
posição real sem SL, sem TP e sem trade associado. O risco aumentou desde que
o buffer deixou de expirar por tempo.

GAP A (FASE 3) — o PLANO_FIX_SL_ANCORADO_NO_SINAL parou na FASE 4; falta a UI
que separa tempo PENDENTE (desde a ordem) de tempo EM POSIÇÃO (desde o fill).
Sem isso o mesmo trade parece duas operações diferentes entre bot e corretora.
A Fase 6 daquele plano (SL_PERCENT_MISMATCH) já está coberta — não refazer.

REGRAS CRÍTICAS:
- Só adicionar. 320 testes verdes e npm run build limpo ao final de cada fase.
- siteId entra como parâmetro OPCIONAL NO FIM das assinaturas do
  bybit-client.service.ts — nenhuma chamada existente pode quebrar. Sem siteId,
  os headers devem ficar IDÊNTICOS aos de hoje. O x-site-id NÃO entra no payload
  assinado (HMAC inalterado).
- Precedência do siteId: portfólio -> env BYBIT_SITE_ID -> nenhum.
- O reset NUNCA pode apagar um trade cuja ordem ainda esteja viva na corretora.
  Cancelar ordens só com o parâmetro explícito cancelOrphanOrders=true e log de
  cada cancelamento. dryRun continua sendo o padrão.
- Não alterar fórmulas de preço de TP/SL nem o comportamento do buffer.

Sem comentários em código. Liste mudanças por arquivo e o que cada teste cobre.
```
