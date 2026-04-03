# 🚨 CORREÇÃO URGENTE - IP Ban Binance

## Problema
IP ainda sendo banido porque **WebSocket não está ativo** e código faz muitos requests.

## Solução Imediata (2 minutos)

### 1. Ativar WebSocket no Railway

**Railway Dashboard → Seu Projeto → Variables**

Adicione estas variáveis:
```
BINANCE_WS_ENABLED=true
BINANCE_WS_FALLBACK_ENABLED=true
```

**IMPORTANTE**: Clique em "Deploy" após adicionar.

### 2. Aguardar Ban Expirar

Segundo o log, ban expira em:
```
IP banned until 1775241020425
```

Converter timestamp: **18:10 PM (horário local)**

**Aguarde até 18:11 PM antes de testar novamente.**

### 3. Verificar após Deploy

```bash
curl https://seu-app.railway.app/health/websockets
```

Deve retornar:
```json
{
  "enabled": true,
  ...
}
```

Se retornar `"enabled": false`, o Railway não aplicou as variáveis.

---

## Por Que Aconteceu

1. **WebSocket não está ativo** - Variáveis de ambiente faltando
2. **CCXT fazendo requests extras** - ExchangeService sem cache adequado
3. **Múltiplos requests na criação** - Balance + Rules + Position Mode + Leverage

---

## Próximos Passos

### Após Ativar WebSocket:

1. ✅ Deploy com variáveis
2. ⏰ Aguardar ban expirar (18:11 PM)
3. 🧪 Testar uma ordem
4. 📊 Verificar logs:
   - Deve aparecer `[WS] Connected`
   - Deve aparecer `[UDS] Connected: strategy-xxx`
   - NÃO deve aparecer HTTP 418

---

## Se Continuar com Erro

Execute no Railway terminal:
```bash
echo $BINANCE_WS_ENABLED
echo $BINANCE_WS_FALLBACK_ENABLED
```

Se não mostrar `true`, as variáveis não foram aplicadas.

**Solução:**
1. Delete as variáveis
2. Adicione novamente
3. Force redeploy:
   ```bash
   git commit --allow-empty -m "trigger deploy"
   git push
   ```

---

## Redução Esperada

Com WebSocket ativo:
```
ANTES: 100+ requests/min → BAN
DEPOIS: ~5 requests/min → SEM BAN
```

---

**⏰ AGUARDE ATÉ 18:11 PM ANTES DE TESTAR!**

O IP está banido até lá. Se testar antes, vai renovar o ban.
