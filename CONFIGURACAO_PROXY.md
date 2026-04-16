# 🚀 GUIA RÁPIDO - Configuração do Proxy ISP

## ⚡ CONFIGURAÇÃO EM 3 PASSOS

### 📝 PASSO 1: Adicionar Variáveis no Railway

Vá para Railway → Seu Projeto → Variables e adicione:

```env
GEONIX_PROXY_HOST=212.68.183.134
GEONIX_PROXY_USER=gallapaguxtnn
GEONIX_PROXY_PASS=zBlDja6345
GEONIX_PROXY_HTTP_PORT=59100
GEONIX_PROXY_SOCKS_PORT=59101
```

![Railway Variables](https://i.imgur.com/example.png)

---

### 🚢 PASSO 2: Deploy

1. Salve as variáveis
2. Faça commit e push do código:

```bash
git add .
git commit -m "feat: add Geonix ISP proxy support to avoid Binance IP ban"
git push
```

3. Aguarde deploy automático no Railway (2-3 minutos)

---

### ✅ PASSO 3: Verificar

#### 3.1. Verificar Logs

No Railway, vá em Deployments → Latest → Logs

**Deve aparecer:**
```
[PROXY] ✅ Proxy ISP configurado: http://gallapaguxtnn:****@212.68.183.134:59100
[PROXY] ✅ IP dedicado: 212.68.183.134
```

#### 3.2. Testar Endpoint

```bash
curl https://seu-backend.railway.app/api/test/binance-ban
```

**Se NÃO estiver banido:**
```json
{
  "success": true,
  "message": "IP NOT BANNED! ✅"
}
```

**Se AINDA estiver banido:**
```json
{
  "success": false,
  "banned": true,
  "message": "IP STILL BANNED ❌"
}
```

---

## 🎯 O QUE ACONTECE AGORA?

### ✅ TODAS as requisições à Binance passam pelo proxy ISP

- Criar ordens ✅
- Cancelar ordens ✅
- Buscar posições ✅
- Sincronizar dados ✅
- Listen key (WebSocket) ✅

### ✅ IP dedicado limpo

- IP: `212.68.183.134`
- Não compartilhado
- Válido até: 17/05/2026

### ✅ Sem mais bans!

- Requisições limitadas e controladas
- WebSocket mantém conexão constante
- Proxy garante IP fixo e limpo

---

## ⏳ SE AINDA ESTIVER BANIDO

### Aguarde o ban expirar

Verifique o timestamp do ban:

```bash
curl https://seu-backend.railway.app/api/test/binance-ban
```

Resultado mostra quando expira:
```json
{
  "banUntilTimestamp": "82949",  // segundos restantes
  "timestamp": "2026-04-13T02:38:17.148Z"
}
```

**82949 segundos = ~23 horas**

### Quando o ban expirar:

1. ✅ NÃO faça nada - sistema já está configurado
2. ✅ Proxy vai proteger contra novos bans
3. ✅ Teste com ordem pequena primeiro (10 USDT)

---

## 📊 MONITORAMENTO

### Verificar se proxy está ativo:

```bash
# Logs do Railway devem mostrar:
[PROXY] ✅ Proxy ISP configurado

# E NÃO deve mais aparecer:
❌ Request failed with status code 418
```

### Health Check:

```bash
curl https://seu-backend.railway.app/api/health/websockets
```

Deve mostrar WebSocket conectado.

---

## 🆘 PROBLEMAS?

### Proxy não aparece nos logs

**Solução**: Verifique se variáveis estão corretas no Railway

### Ainda recebe 418

**Solução**:
1. Aguarde ban expirar
2. Verifique se proxy está ativo nos logs
3. Teste endpoint de diagnóstico

### WebSocket não conecta

**Solução**: Restart do backend no Railway

---

## 💰 CUSTO

- **Proxy Geonix**: $1.65/mês
- **Railway**: ~$10-20/mês (sem mudanças)
- **Total**: $11.65-21.65/mês

**VS Ban**: Priceless! 😄

---

## 📞 SUPORTE

- Documentação completa: `/backend/PROXY_SETUP.md`
- Geonix: https://geonix.com
- Railway: https://railway.app

---

## ✅ CHECKLIST

- [ ] Variáveis adicionadas no Railway
- [ ] Código commitado e pushed
- [ ] Deploy concluído
- [ ] Logs mostram proxy ativo
- [ ] Endpoint de teste funciona
- [ ] Aguardando ban expirar (se necessário)

**Pronto! Sistema configurado e protegido contra bans! 🎉**
