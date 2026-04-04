# Solução para IP Ban na Binance

## Problema Identificado

Cada ordem estava fazendo **7+ requests REST** de uma vez:

1. ✅ Balance fetch
2. ✅ Get position mode
3. ❌ Set margin mode (FALHA - sem permissão)
4. ❌ Set leverage (FALHA - sem permissão)
5. ✅ Verify hedge mode
6. ✅ Exchange info/rules
7. ✅ Create order

**Resultado**: IP ban após 2-3 ordens porque requests que falham AINDA consomem rate limit.

## Solução Implementada

### 1. WebSocket Streams (JÁ ATIVO)
- ✅ User Data Stream conectando
- ✅ Market Data Stream conectando
- ✅ Caching de preços funcionando

### 2. Nova Variável de Ambiente

Adicionei flag para **pular configurações já definidas**:

```env
BINANCE_SKIP_POSITION_CONFIG=true
```

**Com essa flag**:
- Balance: 1 request (primeira vez, depois usa cache de 10s)
- Exchange info: 1 request (primeira vez, depois usa cache de 1h)
- Create order: 1 request

**Total: 1-3 requests** (redução de 70%)

## Próximos Passos

### 1️⃣ Adicionar Variável no Railway

Acesse Railway Dashboard → seu projeto → Settings → Variables

Adicione:
```
BINANCE_SKIP_POSITION_CONFIG=true
```

### 2️⃣ Aguardar Ban Expirar

**Ban atual expira**: 04/04/2026 às **01:44:25 AM** (1:44 AM)

### 3️⃣ Deploy

```bash
git add .
git commit -m "feat: reduce Binance API requests to prevent IP ban"
git push
```

### 4️⃣ Verificar Configurações na Binance

Antes de testar, **confirme manualmente** na Binance:

1. **Position Mode**: Hedge Mode (Dual Position)
2. **Margin**: ISOLATED (para DOGEUSDT)
3. **Leverage**: 10x (para DOGEUSDT)

Essas configurações NÃO serão mais ajustadas automaticamente com a flag ativa.

### 5️⃣ Testar (Após 01:44 AM)

1. Envie ordem pequena de teste
2. Monitore logs - deve ver:
   ```
   [CONFIG] Skipping position settings - assuming already configured
   ```
3. Verifique `/health/websockets`:
   ```json
   {
     "enabled": true,
     "userDataStreams": { "active": 1 },
     "marketDataStreams": { "mainnet": { "connected": true } }
   }
   ```

## Resultado Esperado

**Antes**:
- 7 requests por ordem
- IP ban após 2-3 ordens

**Depois**:
- 1-3 requests por ordem (70% menos)
- Sem IP ban
- Ordens executam normalmente

## Se Ainda Houver Problemas

Caso o ban persista mesmo após essas mudanças:

1. Aumente o cache de balance para 30s (linha 299 do webhook.service.ts)
2. Considere limitar ordens a 1 por minuto temporariamente
3. Verifique se há outros processos fazendo requests com a mesma API key
