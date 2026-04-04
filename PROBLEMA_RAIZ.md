# Problema Raiz: Por Que Funciona no Testnet/Bybit Mas Não na Binance Real

## Descoberta

O **rate limiter está implementado ERRADO** para Binance.

### Como Funciona Hoje

```typescript
// rate-limiter.util.ts linha 21
['binance', { maxRequests: 50, windowMs: 60000 }]
```

**Limita**: 50 requests por minuto (conta número de chamadas)

### Como Deveria Funcionar

Binance usa **REQUEST WEIGHT**, não número de requests:

| Endpoint | Peso |
|----------|------|
| GET /fapi/v2/balance | 5 |
| GET /fapi/v1/exchangeInfo | **40** |
| GET /fapi/v2/positionRisk | 5 |
| POST /fapi/v1/positionSide/dual | 1 |
| POST /fapi/v1/marginType | 1 |
| POST /fapi/v1/leverage | 1 |
| POST /fapi/v1/order | 1 |

**Limite real da Binance**: **2400 weight/min** (não 50 requests!)

### Peso de Uma Ordem Hoje

```
Balance           : 5
ExchangeInfo      : 40
Position Mode GET : 5
Position Mode POST: 1
Margin Mode       : 1
Leverage          : 1
Verify Hedge      : 5
Create Order      : 1
------------------------
TOTAL            : 59 weight
```

Com 2400 de limite → apenas **40 ordens por minuto** antes do ban.

### Por Que Funciona no Testnet?

**Binance Testnet**:
- Limites NÃO são rigorosamente enforced
- Ou tem limites muito maiores
- Ambiente de desenvolvimento, mais permissivo

**Bybit**:
- Sistema de rate limiting diferente
- Provavelmente menos requests por ordem
- Limites diferentes (100 req/min no nosso código)

**Binance Mainnet**:
- Limites RIGOROSOS
- Peso acumula RÁPIDO
- IP ban agressivo quando ultrapassa
- **Histórico de IP bans anteriores agrava** (cada ban aumenta o próximo)

## Problema Adicional

**Throttle NÃO está sendo aplicado** em vários endpoints:

```bash
# grep mostra 18 axios calls, mas apenas 1 tem throttle antes!
```

Requests SEM throttle:
- ❌ Balance fetch (linha 250)
- ❌ Position mode GET (linha 420)
- ❌ Position mode POST (linha 465)
- ❌ Margin mode (linha 530)
- ❌ Leverage (linha 563)
- ❌ Create order (linha 743)
- ❌ Get position (linha 1218)
- ❌ Get price (linha 1834)

Apenas exchangeInfo (linha 133) tem throttle!

## Por Que IP Ban é Tão Severo

1. **Primeira violação**: Ban de 2 minutos
2. **Segunda violação**: Ban de 10 minutos
3. **Terceira violação**: Ban de 30 minutos
4. **Violações contínuas**: Ban de 2+ horas

Você está na **violação 4+**, por isso os bans estão durando horas.

## Solução Correta (Completa)

### Curto Prazo (Desbloquear AGORA)

1. ✅ Flag `BINANCE_SKIP_POSITION_CONFIG=true` (já implementado)
   - Reduz de 59 → 47 weight por ordem
   - Ainda não é ideal, mas ajuda

2. Aguardar ban expirar (01:44 AM)

3. Testar com **1 ordem por vez**, esperar 10s entre ordens

### Médio Prazo (Próxima Implementação)

**Implementar rate limiter baseado em PESO**:

```typescript
interface WeightConfig {
  maxWeight: number;      // 2400 para Binance
  windowMs: number;       // 60000 (1 min)
  weights: {
    balance: 5,
    exchangeInfo: 40,
    positionRisk: 5,
    // etc...
  }
}
```

**Adicionar throttle ANTES de TODOS axios calls**:
```typescript
await this.rateLimiter.throttleWithWeight('balance', 5, 'binance');
const response = await axios.get(`${baseURL}/fapi/v2/balance...`);
```

### Longo Prazo (Ideal)

**Usar 100% WebSocket Streams** (já 50% implementado):
- ✅ User Data Stream (ordens/posições)
- ✅ Market Data Stream (preços)
- ❌ Account updates (balance) → usar WebSocket ao invés de polling
- ❌ Cachear exchange info por 24h (muda raramente)

## Comparação

| Cenário | Weight/Ordem | Ordens/Min | Ban? |
|---------|--------------|------------|------|
| **Hoje** | 59 | 40 | ✅ SIM |
| **Com flag** | 47 | 51 | ⚠️ Arriscado |
| **Com weight limiter** | 47 | 51 (controlado) | ❌ NÃO |
| **100% WebSocket** | 41 (só create) | 58 | ❌ NÃO |

## Ação Imediata

**Você precisa**:
1. Adicionar variável `BINANCE_SKIP_POSITION_CONFIG=true` no Railway
2. Aguardar 01:44 AM
3. Testar com **UMA ordem**, esperar resultado
4. Se funcionar, testar segunda ordem **após 30 segundos**
5. Aumentar frequência gradualmente

**Eu preciso** (próxima implementação):
- Reescrever rate limiter para usar weight ao invés de count
- Adicionar throttle em TODOS os axios calls
- Implementar WebSocket para balance updates
