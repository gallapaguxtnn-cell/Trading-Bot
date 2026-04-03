# Binance WebSocket Streams - Guia de Configuração

## O Que Foi Implementado

Sistema completo de WebSocket Streams da Binance para eliminar rate limiting e bans de IP (HTTP 418).

### Funcionalidades

- **User Data Stream**: Recebe eventos de ordens (filled, cancelled) em tempo real
- **Market Data Stream**: Recebe preços atualizados em tempo real
- **Event-Driven Architecture**: Substitui polling por eventos WebSocket
- **Auto-Reconnection**: Reconexão automática com exponential backoff
- **Fallback Safety Net**: Polling continua ativo como backup
- **Health Monitoring**: Endpoint `/health/websockets` para monitoramento

---

## Redução de Rate Limit

### Antes (Polling)
```
StopLoss: 60 requests/min
TakeProfit: 6 requests/min
PositionSync: 2 requests/min
Preços: ~100 requests/min
TOTAL: ~170 requests/min → BAN HTTP 418
```

### Depois (WebSocket)
```
WebSocket Events: ~0 REST requests
Cron Fallback: ~8 requests/min
TOTAL: ~8 requests/min → SEM BANS
```

**Redução: 95%**

---

## Configuração

### 1. Variáveis de Ambiente

Adicione ao seu `.env`:

```bash
BINANCE_WS_ENABLED=true
BINANCE_WS_FALLBACK_ENABLED=true
```

**Opções:**

- `BINANCE_WS_ENABLED=true` → Ativa WebSocket Streams
- `BINANCE_WS_ENABLED=false` → Desativa (volta ao polling)
- `BINANCE_WS_FALLBACK_ENABLED=true` → Mantém polling como backup
- `BINANCE_WS_FALLBACK_ENABLED=false` → Desativa polling (só WebSocket)

### 2. Deploy no Railway

```bash
# No Railway Dashboard:
# Settings → Environment Variables

BINANCE_WS_ENABLED=true
BINANCE_WS_FALLBACK_ENABLED=true
```

Faça redeploy:
```bash
git add .
git commit -m "feat: implement Binance WebSocket Streams"
git push origin main
```

---

## Como Funciona

### 1. User Data Stream

Quando você **cria/ativa uma estratégia**:
1. Sistema pega listen key da Binance
2. Conecta WebSocket ao stream do usuário
3. Renova listen key automaticamente a cada 25 minutos
4. Recebe eventos de ordens em tempo real

**Eventos capturados:**
- Ordem preenchida (FILLED)
- Ordem cancelada (CANCELLED)
- Mudanças em posições
- Atualizações de balance

### 2. Market Data Stream

Quando você **abre uma ordem**:
1. Sistema subscreve ao ticker do símbolo
2. Recebe preço atualizado em tempo real (<100ms)
3. Cache de preços disponível instantaneamente
4. Remove subscripção quando trade fecha

### 3. Fallback Automático

Se WebSocket falhar:
1. Sistema detecta desconexão
2. Tenta reconectar automaticamente
3. Enquanto reconecta, polling continua ativo
4. Quando reconectar, desativa polling novamente

---

## Monitoramento

### Endpoint de Health

```bash
GET /health/websockets
```

**Resposta:**
```json
{
  "enabled": true,
  "userDataStreams": [
    {
      "strategyId": "abc123",
      "connected": true,
      "lastMessageAt": 1774875000000,
      "reconnectAttempts": 0
    }
  ],
  "marketDataStreams": [
    {
      "isTestnet": false,
      "connected": true,
      "symbols": ["BTCUSDT", "ETHUSDT"],
      "lastMessageAt": 1774875001000
    }
  ],
  "messagesPerMinute": 45,
  "timestamp": "2026-03-30T12:00:00.000Z"
}
```

### Logs Esperados

```
[WS] Binance WebSocket service enabled
[WS] Stop Loss WebSocket listeners registered
[WS] Take Profit WebSocket listeners registered
[WS] Position Sync WebSocket listeners registered
[UDS] Connected: strategy-abc123
[MDS] Subscribed: btcusdt
[WS] Stop Loss filled: BTCUSDT - order-123
[BREAK EVEN] TP2+ filled -> SL to Breakeven
```

---

## Correções Implementadas

### ✅ Bug Fix: Breakeven vs Break Again

**Problema Anterior:**
- Quando TP2 batia, Break Again executava em vez de Breakeven
- SL ia para TP1 em vez de Entry

**Solução:**
- Breakeven agora tem **prioridade sobre Break Again**
- Quando `moveSLToBreakeven=true` e TP2 bate → SL vai para entry
- Break Again só executa se Breakeven estiver desativado

**Lógica Corrigida:**
```typescript
if (moveSLToBreakeven && lastTpLevel >= 2) {
  // Move SL para entry (PRIORIDADE)
} else if (breakAgain && lastTpLevel >= 2) {
  // Move SL para TP1 (só se breakeven OFF)
}
```

### ✅ Rate Limiting Eliminado

- User Data Stream captura ordens filled
- Market Data Stream fornece preços
- Crons reduzidos drasticamente:
  - StopLoss: 1s → 10s
  - TakeProfit: 10s → 30s
  - PositionSync: 30s → 5min

---

## Rollback (Se Necessário)

Se algo der errado, rollback instantâneo:

### Opção 1: Desativar via .env
```bash
BINANCE_WS_ENABLED=false
```
Restart do serviço → Volta ao polling

### Opção 2: Ativar Fallback
```bash
BINANCE_WS_FALLBACK_ENABLED=true
```
WebSocket + Polling rodando juntos (duplicação de proteção)

---

## Testando

### 1. Verificar Conexão

```bash
curl https://seu-app.railway.app/health/websockets
```

Deve retornar `enabled: true` e conexões ativas.

### 2. Abrir Uma Ordem

Abra uma ordem e veja os logs:
```
[UDS] Order update: order-123 - FILLED
[WS] Take Profit filled: BTCUSDT - order-123
```

### 3. Verificar Breakeven

Quando TP2 bater, deve aparecer:
```
[BREAK EVEN] TP2+ filled -> SL to Breakeven: moving SL from 0.0920 to 0.0925
```

---

## Arquitetura

```
┌─────────────────────┐
│ BinanceWebSocket    │
│ Module              │
└──────┬──────────────┘
       │
       ├─► UserDataStreamService
       │   ├─ Listen Key Management
       │   ├─ Order Events
       │   └─ Account Updates
       │
       ├─► MarketDataStreamService
       │   ├─ Price Streams
       │   └─ Symbol Management
       │
       └─► BinanceWSHealthService
           └─ Connection Monitoring
```

---

## FAQ

**Q: Preciso mudar algo na Binance API?**
A: Não, whitelist de IP continua igual.

**Q: Bybit continua funcionando?**
A: Sim, Bybit não foi tocado. Tudo igual.

**Q: E se o WebSocket cair?**
A: Auto-reconnect + Polling como backup.

**Q: Posso testar em testnet?**
A: Sim, funciona em testnet e mainnet.

**Q: Como sei se está funcionando?**
A: Veja `/health/websockets` e logs `[WS]`.

---

## Próximos Passos Recomendados

1. **Deploy em produção** com fallback ativo
2. **Monitorar por 24h** via `/health/websockets`
3. **Desativar fallback** gradualmente
4. **Confirmar zero bans** HTTP 418

---

**Status:** ✅ Pronto para produção
**Data:** 2026-03-30
**Versão:** 2.0.0
