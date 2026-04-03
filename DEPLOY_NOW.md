# 🚀 Deploy Imediato - 3 Passos

## ⏰ IMPORTANTE
Seu IP está **banido até 18:10 PM**.
**NÃO TESTE ANTES DESSE HORÁRIO** ou o ban será renovado.

---

## Passo 1: Adicionar Variáveis no Railway (2 min)

1. Acesse: https://railway.app
2. Vá em: **Seu Projeto → Settings → Variables**
3. Clique em: **+ New Variable**
4. Adicione:

```
Nome: BINANCE_WS_ENABLED
Valor: true
```

5. Clique em: **+ New Variable** novamente
6. Adicione:

```
Nome: BINANCE_WS_FALLBACK_ENABLED
Valor: true
```

7. Clique em: **Deploy**

---

## Passo 2: Fazer Push do Código (1 min)

```bash
cd /Users/lucasemanuelpereiraribeiro/Projects/Trading-Bot

git add .
git commit -m "feat: WebSocket Streams + Breakeven fix + Cache"
git push origin main
```

Railway vai fazer deploy automaticamente.

---

## Passo 3: Aguardar e Testar (após 18:11 PM)

### Aguarde até **18:11 PM** (ban expira às 18:10 PM)

Então teste:

```bash
# 1. Verificar se WebSocket está ativo
curl https://trading-bot-production-XXXX.up.railway.app/health/websockets

# Deve retornar:
# {
#   "enabled": true,
#   "userDataStreams": [...],
#   ...
# }
```

### Se retornar `"enabled": false`:

As variáveis não foram aplicadas. **Solução:**

```bash
# Force redeploy
git commit --allow-empty -m "trigger deploy"
git push
```

Aguarde 2 minutos e teste novamente.

---

## Como Saber se Funcionou

### ✅ Sinais de Sucesso:

**Logs do Railway devem mostrar:**
```
[WS] Binance WebSocket service enabled
[WS] Stop Loss WebSocket listeners registered
[WS] Take Profit WebSocket listeners registered
[UDS] Connected: strategy-7059e1cb
[MDS] Subscribed: dogeusdt
```

**Ao abrir ordem:**
```
[WS] Order update: xxx - FILLED
[BREAK EVEN] TP2+ filled -> SL to Breakeven
```

**NÃO deve aparecer:**
```
❌ HTTP 418 I'm a teapot
❌ IP banned
```

### ❌ Se Continuar com Erro 418:

1. Verifique variáveis no Railway
2. Force redeploy
3. Aguarde mais 20 minutos (novo ban)
4. Me avise com os logs completos

---

## Resumo

```
✅ Código: PRONTO (build OK)
✅ Correções: IMPLEMENTADAS
⏰ Ban expira: 18:10 PM
🚀 Deploy: AGORA
🧪 Teste: APÓS 18:11 PM
```

---

**AÇÃO IMEDIATA:**

1. ✅ Railway → Variables → Adicionar BINANCE_WS_ENABLED=true
2. ✅ Railway → Variables → Adicionar BINANCE_WS_FALLBACK_ENABLED=true
3. ✅ Git push
4. ⏰ Aguardar 18:11 PM
5. 🧪 Testar

---

**Precisa de ajuda? Me avise com:**
- Screenshot das variáveis do Railway
- Logs após tentar criar ordem (após 18:11 PM)
- Output do `/health/websockets`
