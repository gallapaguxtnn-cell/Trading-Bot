# PLANO_IA_FIX — Corrigir o uso da IA (Singularity + Trading-Bot)

Plano autossuficiente para o Claude Code CLI. Cobre dois repositórios:
- `Trading-Bot/backend` (NestJS — quem chama a API da Anthropic) → ETAPA A
- `singularity` (frontend Vite/React) → ETAPA B

Execute a ETAPA A numa sessão do CLI dentro de `Trading-Bot`, depois a ETAPA B dentro de `singularity`. Este arquivo existe na raiz dos dois repos.

## REGRAS

1. Sem comentários em código.
2. No Trading-Bot, NÃO tocar em webhook, exchange, strategies, trades, stop-loss, take-profit, websocket — somente `src/ai-chat/*`, `src/app.module.ts` (apenas providers/guards) e testes.
3. Nunca escrever chave de API em arquivo versionado. `.env` não é commitado.
4. Ao final de cada etapa: build passa (`npm run build`) e testes passam.
5. Manter compatibilidade: requests antigos (`{message, history, strategyId, context}`) continuam funcionando.

## ESTADO ATUAL (verificado — não confie na memória, confira nos arquivos)

- `backend/src/ai-chat/ai-chat.service.ts`: client Anthropic criado só no construtor; modelo hardcoded `claude-sonnet-4-20250514`; um único SYSTEM_PROMPT em inglês; sem tratamento de erros da API; sem suporte a anexos.
- `backend/src/ai-chat/ai-chat.controller.ts`: `POST /api/ai-chat` público; `GET /api/ai-chat/status` retorna só `{configured}`.
- `backend/src/app.module.ts`: `ThrottlerModule.forRoot` importado mas SEM `APP_GUARD` → rate-limit não é aplicado a nada.
- `singularity/src/lib/ai-prompt.js`: SYSTEM_PROMPT em português que descreve a plataforma Base44 (o app não roda mais nela — a IA explica erros inexistentes ao cliente).
- `singularity/src/pages/ChatIA.jsx`: concatena SYSTEM_PROMPT + histórico em texto dentro de `message` (linha ~328); `generateScript` (linha ~351) NÃO envia a conversa; anexos viram data-URL base64 salvos no localStorage da conversa e o backend os ignora.
- `singularity/src/api/base44Client.js`: `InvokeLLM({prompt, file_urls})`; `UploadFile` retorna data-URL.
- `singularity/src/components/backtest/TradeLog.jsx`: `askAI(pergunta, [], aiContext)` — fluxo correto, manter.
- `GET /api/ai-chat/status` existe e o frontend nunca o consulta; erros aparecem como "Erro ao responder. Tente novamente."

---

# ETAPA A — BACKEND (executar no repo Trading-Bot)

## A1. `src/ai-chat/ai-chat.service.ts` — reescrever

1. Configuração via env, lida de forma lazy (a cada request, obter o client por um getter que cria a instância se `ANTHROPIC_API_KEY` existir):
   - `ANTHROPIC_API_KEY` (obrigatória para funcionar)
   - `ANTHROPIC_MODEL` default `claude-sonnet-4-6`
   - `ANTHROPIC_MAX_TOKENS` default `2048`
2. Dois system prompts em português, selecionados por `mode`:

`SYSTEM_PROMPT_AUDITOR` (mode `auditor`, default quando vier `context` ou `strategyId`):

```
Você é Singularity AI, analista de operações de trading. Você recebe logs de auditoria, reconciliação de trades com a exchange e comparações backtest × execução real.

Seu papel: analisar qualidade de execução (slippage, latência, taxas), explicar discrepâncias entre backtest e execução real, identificar padrões de erro e sugerir ajustes de parâmetros.

Regras: baseie-se somente nos dados fornecidos, nunca invente números; ao falar de P&L, diga sempre se é bruto ou líquido de taxas; sinalize padrões suspeitos; explique cada issue em linguagem simples para um cliente não técnico, dizendo o que significa e o que fazer; responda no idioma do usuário; seja conciso e acionável.
```

`SYSTEM_PROMPT_ANALYST` (mode `analyst`):

```
Você é Singularity AI, especialista em mercado financeiro, criptomoedas, trading, análise técnica, derivativos (futuros), spot e nas corretoras Binance, Bybit e OKX. Você conhece este sistema: um backtester que roda no navegador (client-side) com otimizadores DYNAMIC (prioriza menor drawdown), EXTREME (prioriza maior lucro) e ULTIMATE (multi-ativo), auditor com validação matemática e comparação com TradingView e com o bot real, e um bot que recebe webhooks do TradingView e executa em Binance/Bybit.

Erros comuns do sistema: símbolo inexistente na exchange/mercado selecionado, exchange fora do ar, otimizações muito grandes pesadas para a máquina, backend indisponível (auditor e IA fora do ar).

Você domina: análise técnica avançada, backtesting quantitativo com matemática precisa, PineScript do TradingView (lê, interpreta e converte em parâmetros executáveis), risk management e estratégias DCA, grid, scalping, swing, tendência e reversão.

REGRAS ABSOLUTAS: preços com até 5 casas decimais em ativos de baixo valor; cálculos exatos; quando o usuário pedir backtest/estratégia, responda em DOIS blocos: (a) explicação objetiva em português, (b) bloco JSON delimitado por ```backtest_config ... ``` com esta estrutura:

{
  "symbol": "DOGEUSDT",
  "strategy": {
    "type": "ema_cross" | "sma_cross" | "rsi",
    "params": { "fast": 5, "slow": 200 },
    "direction": "both",
    "entrySize": "pct_balance",
    "entryValue": 10,
    "tps": [{ "pct": 1, "size": 100 }],
    "sl": { "pct": 1 }
  },
  "initialBalance": 1000,
  "timeframe": "1h",
  "overlays": [{ "type": "ema", "period": 5, "color": "#a855f7", "label": "EMA 5" }]
}

O campo "symbol" DEVE ser o ativo que o usuário mencionou na conversa, sempre no formato USDT. Não use o ativo do gráfico se o usuário pediu outro.
```

3. Assinatura: `chat({ message, history, mode, strategyId, context, attachments })`.
   - `mode`: `'auditor' | 'analyst'`; default: `'analyst'` se não houver `context`/`strategyId`, senão `'auditor'`.
   - `history` (máx 20): vai como mensagens `user`/`assistant` reais no array `messages`.
   - `attachments`: `[{ media_type: string, data_base64: string, name?: string }]` → mapear para blocos de conteúdo da última mensagem user: `{ type: 'image', source: { type: 'base64', media_type, data } }` para `image/*` e `{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }` para PDF. Rejeitar (400) anexo > 5MB ou media_type fora de `image/png|jpeg|webp|gif|application/pdf`.
   - Contexto de auditoria: manter comportamento atual (directContext ou busca por strategyId no AuditorService), anexado ao texto da mensagem do usuário.
4. Tratamento de erros (nunca vazar chave/stack):
   - Client ausente → lançar `HttpException` 503 `{ error: 'ai_not_configured', message: 'IA desativada: defina ANTHROPIC_API_KEY no backend e reinicie o serviço' }`.
   - `Anthropic.APIError` status 401/403 → 503 `{ error: 'ai_unauthorized', message: 'Chave de API inválida ou revogada' }`.
   - Status 429 ou 529 → 503 `{ error: 'ai_rate_limited', message: 'Limite de uso da IA atingido, tente novamente em instantes' }`.
   - Timeout de 60s (opção `timeout` do SDK) e demais erros → 502 `{ error: 'ai_error', message: 'Falha ao consultar a IA' }`, logando o detalhe no Logger.
5. `isConfigured()` passa a verificar a env em tempo real. Novo método `getStatusInfo()` → `{ configured, model, protected }` (`protected` = `!!AI_CHAT_TOKEN`).

## A2. `src/ai-chat/ai-chat.controller.ts`

1. DTO: adicionar `mode?: 'auditor' | 'analyst'` e `attachments?: Array<{ media_type: string; data_base64: string; name?: string }>`. Validar `message` não vazio (400).
2. `@Throttle({ default: { limit: 10, ttl: 60000 } })` no `POST`.
3. Guard opcional por token: criar `src/ai-chat/ai-token.guard.ts` — se env `AI_CHAT_TOKEN` definida, exigir header `x-ai-token` igual (senão 401 `{ error: 'ai_forbidden' }`); se a env não existir, permitir tudo. Aplicar `@UseGuards(AiTokenGuard)` no controller.
4. `GET /api/ai-chat/status` → retorno de `getStatusInfo()`.

## A3. `src/app.module.ts`

Adicionar `{ provide: APP_GUARD, useClass: ThrottlerGuard }` aos providers (import de `@nestjs/core` e `@nestjs/throttler`). Verificar que o `ThrottlerModule.forRoot` existente tem ttl/limit globais razoáveis (ex.: 100 req/60s) — o webhook do TradingView NÃO pode ser estrangulado: aplicar `@SkipThrottle()` no controller do webhook e em qualquer endpoint chamado por máquina (position-sync, binance-ws se houver HTTP).

## A4. Testes — `src/ai-chat/ai-chat.service.spec.ts`

Mockar o SDK da Anthropic. Casos: sem chave → 503 ai_not_configured; 401 → ai_unauthorized; 429 → ai_rate_limited; sucesso com history no array messages; mode auditor usa SYSTEM_PROMPT_AUDITOR e analyst usa SYSTEM_PROMPT_ANALYST; anexo PDF vira bloco document; anexo 6MB → 400. Rodar `npm run build && npx jest src/ai-chat --passWithNoTests=false`.

---

# ETAPA B — FRONTEND (executar no repo singularity)

## B1. `src/api/base44Client.js`

1. `InvokeLLM({ message, history, mode, attachments })` → `POST ${API_URL}/api/ai-chat` com esse body; incluir header `x-ai-token: import.meta.env.VITE_AI_CHAT_TOKEN` quando definido. Em `!res.ok`, ler o JSON de erro e lançar `Error(data.message || 'Erro ao chamar IA')` com `err.code = data.error`.
2. `UploadFile({ file })` → retornar `{ name: file.name, media_type: file.type, data_base64 }` (base64 puro, sem prefixo data-URL). Rejeitar > 5MB com mensagem clara.

## B2. `src/lib/ai-status.js` (novo)

`getAiStatus()` com cache de 60s. Estados: `no_api_url` (VITE_API_URL vazia), `offline` (fetch de `${API_URL}/api/ai-chat/status` falhou), `not_configured` (`configured === false`), `ready` (retornar também `model`). Exportar também `AI_STATUS_MESSAGES` em português:
- `no_api_url`: "Backend não configurado (VITE_API_URL). IA e auditor remoto desativados."
- `offline`: "Backend indisponível — verifique o deploy no Railway."
- `not_configured`: "IA desativada — defina ANTHROPIC_API_KEY no backend e reinicie o serviço."

## B3. `src/pages/ChatIA.jsx`

1. `send`: substituir a montagem de prompt (SYSTEM_PROMPT + histórico em texto) por:
   `InvokeLLM({ message: content, history: withUser.slice(-21, -1).map(m => ({ role: m.role, content: m.content })), mode: 'analyst', attachments: attachedFile ? [attachedFile] : undefined })`.
   Na mensagem salva na conversa, guardar apenas `file_name` (NUNCA o base64).
2. `generateScript`: incluir a conversa — `history: messages.slice(-10).map(...)` e `message: 'Gere um PineScript completo e funcional para TradingView da estratégia discutida nesta conversa. Retorne APENAS o código.'`, `mode: 'analyst'`.
3. `saveScript` e `saveParam`: usar a nova assinatura com `mode: 'analyst'`.
4. Remover import de `SYSTEM_PROMPT`; em `src/lib/ai-prompt.js` manter somente `parseBacktestConfig` (deletar o SYSTEM_PROMPT com referências à Base44).
5. Status/erros: no mount, chamar `getAiStatus()`; se não `ready`, exibir banner com a mensagem correspondente e desabilitar input/envio (tooltip com o motivo). No catch do envio, exibir `err.message` real em vez de "Erro ao responder. Tente novamente.".

## B4. `src/components/backtest/TradeLog.jsx`

1. `askAI` → adicionar `mode: 'auditor'` (ajustar `askAI` em `src/lib/auditor-api.js` para aceitar e repassar `mode`, mantendo assinatura retrocompatível).
2. Antes de abrir o chat da IA, consultar `getAiStatus()`; se não `ready`, mostrar a mensagem do B2 no lugar do chat.

## B5. Validação

`npm run build && npx vitest run`. Teste manual: sem `VITE_API_URL` → banners corretos; com backend ok → ChatIA responde, gera script baseado na conversa, anexo PDF é comentado pela IA, auditoria + "Perguntar à IA" explica os erros.

---

# ETAPA C — CONFIGURAÇÃO (manual, fora do CLI)

1. Railway → serviço backend (Trading-Bot) → Variables:
   - `ANTHROPIC_API_KEY` = chave nova (já rotacionada)
   - `ANTHROPIC_MODEL` = `claude-sonnet-4-6` (opcional)
   - `AI_CHAT_TOKEN` = string aleatória longa (opcional, recomendado se o site é público)
2. Railway → serviço singularity → Variables (build time, exige rebuild):
   - `VITE_API_URL` = URL pública do backend, sem barra final
   - `VITE_AI_CHAT_TOKEN` = mesmo valor de `AI_CHAT_TOKEN` (se usado)
3. Local: `Trading-Bot/backend/.env` → descomentar `ANTHROPIC_API_KEY=...`; `singularity/.env` → `VITE_API_URL=http://localhost:3000`.
4. Console Anthropic → Billing → definir limite mensal de gasto.
5. Smoke test:
```bash
curl https://SEU-BACKEND/api/ai-chat/status
curl -X POST https://SEU-BACKEND/api/ai-chat -H "Content-Type: application/json" \
  -d '{"message":"Teste: responda apenas OK","mode":"analyst"}'
for i in $(seq 1 15); do curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://SEU-BACKEND/api/ai-chat -H "Content-Type: application/json" \
  -d '{"message":"x"}'; done
```
Esperado: `configured:true`; resposta "OK"; os últimos requests do loop retornando 429.

# CHECKLIST DE ACEITE

- [ ] `POST /api/ai-chat` com history real, mode e attachments; retrocompatível
- [ ] Erros mapeados (ai_not_configured / ai_unauthorized / ai_rate_limited) chegando legíveis na UI
- [ ] Rate-limit ativo no endpoint de IA e webhook isento de throttle
- [ ] SYSTEM_PROMPT da Base44 eliminado; personas auditor/analyst no backend em português
- [ ] generateScript usa a conversa; anexos chegam à IA; base64 fora do localStorage
- [ ] Banners de status em ChatIA e TradeLog quando IA indisponível
- [ ] Builds e testes passando nos dois repos
