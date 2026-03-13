# Como Obter o IP Público do Railway

## Contexto
Railway não fornece IP fixo. O IP pode mudar a cada deploy/restart da aplicação.

---

## Método 1: Via Endpoint HTTP (Recomendado)

### Passo 1: Acessar o endpoint /ip

Acesse a URL do seu backend no Railway:

```
https://seu-app.railway.app/ip
```

### Passo 2: Copiar o IP retornado

Você verá uma resposta JSON como:

```json
{
  "ip": "52.123.45.67",
  "timestamp": "2026-03-12T10:30:00.000Z",
  "message": "Use this IP to whitelist on Binance/Bybit API settings"
}
```

Copie o valor do campo `ip`.

### Passo 3: Whitelist nas Corretoras

#### **Binance:**
1. Faça login na sua conta Binance
2. Vá em **Conta** > **API Management**
3. Clique em **Editar** na sua API Key
4. Na seção "**Restrict access to trusted IPs only**"
5. Adicione o IP obtido acima
6. Clique em **Save**

#### **Bybit:**
1. Faça login na sua conta Bybit
2. Vá em **Account & Security** > **API**
3. Clique em **Editar** na sua API Key
4. Na seção "**IP Restrictions**"
5. Adicione o IP obtido acima
6. Clique em **Confirm**

---

## Método 2: Via Railway CLI

### Instalação da Railway CLI

```bash
# Instalar Railway CLI globalmente
npm i -g @railway/cli
```

### Obter o IP

```bash
# 1. Login no Railway
railway login

# 2. Link ao seu projeto
railway link

# 3. Executar comando para obter IP público
railway run curl https://api.ipify.org
```

O IP será exibido no terminal.

---

## Método 3: Via Logs do Railway

1. Acesse o Dashboard do Railway
2. Abra o projeto do seu Trading Bot
3. Vá na aba **Deployments**
4. Clique no deployment ativo
5. Abra os **Logs**
6. Faça uma requisição HTTP para `https://seu-app.railway.app/ip`
7. O IP será exibido na resposta JSON nos logs

---

## ⚠️ IMPORTANTE - Limitações do IP no Railway

### O IP pode mudar em:
- ✗ Redeploy da aplicação
- ✗ Restart do serviço Railway
- ✗ Migração de infraestrutura do Railway
- ✗ Escalação automática de recursos

### Recomendações para Produção:

#### **Opção 1: Proxy com IP Fixo**
Use um serviço de proxy com IP dedicado:

**Proveedores:**
- [Bright Data](https://brightdata.com/) - Proxy residencial com IPs dedicados
- [Oxylabs](https://oxylabs.io/) - Proxy datacenter com IP fixo
- [Smartproxy](https://smartproxy.com/) - Proxy com IPs estáticos

**Configuração no .env:**
```env
HTTP_PROXY=http://usuario:senha@proxy.provedor.com:8080
HTTPS_PROXY=http://usuario:senha@proxy.provedor.com:8080
```

#### **Opção 2: Migrar para VPS com IP Dedicado**

**Proveedores VPS:**
- [DigitalOcean](https://www.digitalocean.com/) - Droplets a partir de $6/mês
- [AWS EC2](https://aws.amazon.com/ec2/) - Elastic IP gratuito
- [Vultr](https://www.vultr.com/) - VPS com IP dedicado
- [Linode](https://www.linode.com/) - Cloud computing com IP fixo

**Vantagens:**
- ✓ IP fixo permanente
- ✓ Maior controle sobre a infraestrutura
- ✓ Melhor para produção de alta confiabilidade

#### **Opção 3: Whitelist sem restrição de IP (NÃO RECOMENDADO)**

**⚠️ ATENÇÃO:** Apenas use esta opção se você:
- Habilitar autenticação de 2 fatores (2FA) na conta da corretora
- Configurar permissões mínimas necessárias na API Key (apenas spot trading, sem withdrawals)
- Monitorar logs de acesso regularmente

---

## FAQ - Perguntas Frequentes

### 1. Como saber se meu IP mudou?

Acesse `https://seu-app.railway.app/ip` e compare com o IP anterior salvo.

### 2. O que acontece se o IP mudar e eu não atualizar?

Suas ordens falharão com erro de autenticação:
- Binance: `API-key IP mismatch`
- Bybit: `IP not in whitelist`

### 3. Posso automatizar a atualização do IP?

Não é possível atualizar o whitelist automaticamente via API (por segurança).
Você precisará atualizar manualmente sempre que o IP mudar.

### 4. Quantos IPs posso adicionar no whitelist?

- **Binance:** Até 4 IPs por API Key (limite pode variar)
- **Bybit:** Até 20 IPs por API Key

### 5. O Railway notifica quando o IP muda?

Não. Você precisará monitorar manualmente ou implementar um sistema de notificação.

**Exemplo de monitoramento:**

```typescript
// Adicionar ao seu backend
@Cron('0 */6 * * *')  // A cada 6 horas
async checkIPChange() {
  const currentIP = await this.getCurrentIP();
  const lastKnownIP = await this.redis.get('last_known_ip');

  if (currentIP !== lastKnownIP) {
    await this.notificationService.sendAlert(
      `⚠️ IP CHANGED: ${lastKnownIP} → ${currentIP}. Update whitelist ASAP!`
    );
    await this.redis.set('last_known_ip', currentIP);
  }
}
```

---

## Suporte

Se você encontrar problemas:

1. Verifique se o endpoint `/ip` está funcionando
2. Confirme que o IP foi adicionado corretamente no whitelist
3. Teste a API Key com uma requisição simples (ex: GET /account)
4. Verifique os logs do Railway para erros de autenticação

Para mais informações sobre a Railway CLI: https://docs.railway.app/develop/cli

---

**Última atualização:** 2026-03-12
