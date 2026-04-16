# 🌐 Configuração do Proxy ISP (Geonix)

## ✅ O QUE FOI IMPLEMENTADO

O bot agora suporta proxy ISP dedicado para todas as requisições à Binance, resolvendo o problema de IP ban.

### Mudanças Implementadas:

1. **ProxyUtil** (`src/utils/proxy.util.ts`):
   - Gerencia configuração do proxy ISP
   - Suporta HTTP e SOCKS5
   - Inicialização automática no startup

2. **BinanceRequestUtil** (`src/utils/binance-request.util.ts`):
   - Wrapper para todas as requisições HTTP à Binance
   - Aplica proxy automaticamente em todas as chamadas
   - Logs detalhados de erros (incluindo 418)

3. **Serviços Atualizados**:
   - ✅ `user-data-stream.service.ts` - Listen key creation/renewal
   - ✅ `webhook.service.ts` - Criação de ordens
   - ✅ `position-sync.service.ts` - Sincronização de posições
   - ✅ `stop-loss.service.ts` - Gerenciamento de SL
   - ✅ `take-profit.service.ts` - Gerenciamento de TP
   - ✅ `trades.controller.ts` - Fechamento de posições
   - ✅ `strategies.service.ts` - Consultas de estratégias

---

## 🔧 CONFIGURAÇÃO NO RAILWAY

### Passo 1: Acessar Railway Dashboard

1. Vá para https://railway.app
2. Selecione seu projeto
3. Clique no serviço backend
4. Vá em "Variables"

### Passo 2: Adicionar Variáveis de Ambiente

Adicione as seguintes variáveis:

```env
GEONIX_PROXY_HOST=212.68.183.134
GEONIX_PROXY_USER=gallapaguxtnn
GEONIX_PROXY_PASS=zBlDja6345
GEONIX_PROXY_HTTP_PORT=59100
GEONIX_PROXY_SOCKS_PORT=59101
```

**IMPORTANTE:** Substitua os valores acima pelos seus dados reais do Geonix!

### Passo 3: Deploy

1. Salve as variáveis
2. Clique em "Deploy" ou faça um novo commit no GitHub
3. Aguarde o deploy completar

---

## 📋 VERIFICAÇÃO

### 1. Verificar Logs no Startup

Após o deploy, verifique os logs no Railway. Você deve ver:

```
[PROXY] ✅ Proxy ISP configurado: http://gallapaguxtnn:****@212.68.183.134:59100
[PROXY] ✅ IP dedicado: 212.68.183.134
[WS-INIT] Initializing WebSocket connections for active strategies
```

### 2. Testar Endpoint de Ban

Faça uma requisição para:

```bash
GET https://seu-backend.railway.app/api/test/binance-ban
```

**Resposta esperada (se NÃO estiver banido):**

```json
{
  "success": true,
  "message": "IP NOT BANNED! Listen key created successfully ✅",
  "listenKey": "pqia91ma19a5s61cv6a81va65qdf19v8a65a1a5s61cv6a81va65qdf19v8a65a1"
}
```

**Resposta se AINDA estiver banido:**

```json
{
  "success": false,
  "banned": true,
  "message": "IP STILL BANNED ❌",
  "error": {...}
}
```

### 3. Verificar Proxy em Ação

Quando uma ordem for criada, verifique os logs. Você NÃO deve mais ver erros 418.

---

## 🎯 COMO FUNCIONA

### Fluxo Sem Proxy (ANTES):

```
Bot → Binance API (IP do Railway compartilhado)
                   ❌ IP ban 418
```

### Fluxo Com Proxy (AGORA):

```
Bot → Proxy ISP (212.68.183.134) → Binance API
                ✅ IP dedicado limpo
```

### Transparência Total:

- ✅ **Automático**: Proxy é aplicado automaticamente em TODAS as chamadas
- ✅ **Fallback**: Se proxy não estiver configurado, usa conexão direta
- ✅ **Zero mudanças** no código de lógica de negócio
- ✅ **Mantém funcionalidades**: WebSocket, caching, tudo continua funcionando

---

## 🔍 TROUBLESHOOTING

### Problema: "Proxy não configurado - rodando sem proxy"

**Causa**: Variáveis de ambiente não foram configuradas

**Solução**: Verifique se GEONIX_PROXY_HOST, GEONIX_PROXY_USER e GEONIX_PROXY_PASS estão definidos

---

### Problema: Ainda recebendo erro 418

**Causas possíveis**:
1. IP ainda está banido (aguarde expiração do ban)
2. Proxy não está sendo usado (verifique logs de startup)
3. Credenciais do proxy incorretas

**Diagnóstico**:
1. Verifique logs de startup: deve aparecer `✅ Proxy ISP configurado`
2. Teste endpoint `/api/test/binance-ban`
3. Verifique se variáveis estão corretas no Railway

---

### Problema: "Connection failed" ao criar listen key

**Causa**: Proxy Geonix pode estar offline ou credenciais incorretas

**Solução**:
1. Verifique status do Geonix: https://geonix.com/dashboard
2. Confirme se IP `212.68.183.134` ainda está ativo
3. Verifique se não expirou (válido até 17.05.2026)

---

## 💡 DICAS

### Renovação do Proxy

- Proxy expira em: **17/05/2026** (30 dias)
- Antes de expirar, renove no Geonix e atualize variáveis no Railway

### Múltiplas Estratégias

- O mesmo proxy serve para TODAS as estratégias Binance
- Não precisa de IP diferente para cada estratégia
- Economia: $1.65/mês para quantas estratégias quiser

### Performance

- Proxy ISP adiciona ~20-50ms de latência
- Totalmente aceitável para trading (ordens ainda executam rápido)
- Muito melhor que ser banido!

---

## 📊 MONITORAMENTO

### Logs Importantes:

**Startup bem-sucedido:**
```
[PROXY] ✅ Proxy ISP configurado: http://***:****@212.68.183.134:59100
[WS-INIT] ✅ Connected User Data Stream for strategy TEST BINANCE REAL (mainnet)
```

**Requisição bem-sucedida:**
```
[BINANCE-REQUEST] GET https://fapi.binance.com/fapi/v1/exchangeInfo - 200 OK
```

**Erro 418 (NÃO deveria mais aparecer):**
```
[BINANCE-REQUEST] ❌ IP BANNED (418) - Mesmo usando proxy!
```
*Se isso aparecer, entre em contato - há algo errado na configuração*

---

## ✅ CHECKLIST PÓS-IMPLEMENTAÇÃO

- [ ] Variáveis de ambiente configuradas no Railway
- [ ] Deploy concluído com sucesso
- [ ] Logs mostram "Proxy ISP configurado"
- [ ] Endpoint `/test/binance-ban` retorna sucesso
- [ ] Ordens estão sendo criadas sem erro 418
- [ ] WebSocket conectando normalmente

---

## 🚀 PRÓXIMOS PASSOS

Após configuração bem-sucedida:

1. **Aguarde ban expirar** (se ainda estiver banido)
2. **Teste com ordem pequena** (10 USDT)
3. **Monitore por 24h** para garantir estabilidade
4. **Retorne ao uso normal**

---

## 📞 SUPORTE

Se encontrar problemas:

1. Verifique este documento primeiro
2. Confira logs no Railway
3. Teste endpoint de diagnóstico
4. Verifique dashboard do Geonix

**Geonix Support**: https://geonix.com/support
**Railway Logs**: https://railway.app → Seu Projeto → Deployments → Logs
