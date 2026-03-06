# 🌐 Configuração de Proxy para Bybit API

## ⚠️ Problema Identificado

A Bybit está bloqueando acessos de certas regiões via CloudFront:
```
"The Amazon CloudFront distribution is configured to block access from your country."
```

## ✅ Soluções Disponíveis

### Opção 1: Proxy HTTP/HTTPS (Recomendado)

O bot já está configurado para usar proxy. Basta adicionar a variável de ambiente `HTTP_PROXY`.

#### 1.1 Configuração no arquivo `.env`

Edite o arquivo `/backend/.env` e adicione:

```bash
# Proxy HTTP simples (sem autenticação)
HTTP_PROXY=http://proxy-host:porta

# OU proxy HTTPS
HTTPS_PROXY=https://proxy-host:porta

# OU proxy com autenticação
HTTP_PROXY=http://usuario:senha@proxy-host:porta
```

#### 1.2 Exemplos de Proxies Públicos (Para Teste)

**⚠️ ATENÇÃO**: Proxies públicos não são seguros para uso em produção. Use apenas para testes!

```bash
# Exemplo de configuração (NÃO use em produção)
HTTP_PROXY=http://proxy-public-server:8080
```

### Opção 2: Serviços de Proxy Profissionais (Produção)

Para uso em produção com bot de trading, use serviços pagos e confiáveis:

#### Serviços Recomendados:

1. **Bright Data (Luminati)** - https://brightdata.com/
   - Proxies residenciais em 195 países
   - Alta confiabilidade
   - Custo: ~$500/mês (plano básico)

2. **Smartproxy** - https://smartproxy.com/
   - Proxies residenciais
   - Custo: ~$75/mês (8GB)

3. **Proxy-Seller** - https://proxy-seller.com/
   - Proxies privados
   - Custo: ~$2-5/proxy/mês

4. **IPRoyal** - https://iproyal.com/
   - Proxies residenciais e datacenter
   - Custo: ~$1.75/GB

**Configuração após contratar:**
```bash
# Exemplo com Smartproxy
HTTP_PROXY=http://usuario:senha@gate.smartproxy.com:7000

# Exemplo com Bright Data
HTTP_PROXY=http://usuario:senha@zproxy.lum-superproxy.io:22225
```

### Opção 3: VPN no Servidor

Se o bot está rodando em um servidor, instale uma VPN:

#### 3.1 Usando NordVPN (Recomendado para 2026)

```bash
# Instalar NordVPN
wget -qO- https://repo.nordvpn.com/deb/nordvpn/debian/pool/main/nordvpn-release_1.0.0_all.deb
sudo dpkg -i nordvpn-release_1.0.0_all.deb
sudo apt update
sudo apt install nordvpn

# Conectar
nordvpn login
nordvpn connect United_States
```

#### 3.2 Usando ExpressVPN

```bash
# Baixar e instalar
wget https://www.expressvpn.works/clients/linux/expressvpn_x.x.x_amd64.deb
sudo dpkg -i expressvpn_*.deb

# Ativar e conectar
expressvpn activate
expressvpn connect
```

### Opção 4: Deploy em Região Permitida

Deploy o bot em um servidor VPS localizado em países onde a Bybit é permitida:

**Países Permitidos:**
- 🇺🇸 Estados Unidos (algumas restrições)
- 🇬🇧 Reino Unido
- 🇩🇪 Alemanha
- 🇫🇷 França
- 🇯🇵 Japão
- 🇰🇷 Coreia do Sul
- 🇸🇬 Singapura (verificar restrições atuais)

**Provedores VPS Recomendados:**

1. **DigitalOcean**
   - Datacenter em múltiplos países
   - Custo: $6/mês (droplet básico)

2. **Vultr**
   - 25 localizações globais
   - Custo: $5/mês

3. **Linode (Akamai)**
   - 11 datacenters
   - Custo: $5/mês

4. **AWS EC2**
   - Múltiplas regiões
   - Custo: ~$3.5/mês (t2.micro)

## 🚀 Como Testar se Funcionou

Após configurar o proxy, reinicie o bot:

```bash
cd /Users/lucasemanuelpereiraribeiro/Projects/Trading-Bot/backend
npm run start:dev
```

Procure nos logs:
```
[BYBIT] Using proxy: http://proxy-host:port  ✅
[BYBIT] Time Sync Check: ... ✅
[BYBIT] UNIFIED Account Balance: ... ✅
```

Se ver a mensagem de geo-blocking novamente:
```
[BYBIT] ⚠️⚠️⚠️  GEO-BLOCKING DETECTED  ⚠️⚠️⚠️
```
Significa que o proxy não está funcionando ou não está configurado.

## ⚡ Solução Rápida (Recomendação)

**Para PRODUÇÃO imediata:**

1. Contrate um VPS em região permitida (DigitalOcean/Vultr)
2. Deploy o bot lá
3. Custo: ~$5-10/mês
4. Sem necessidade de proxy

**Para DESENVOLVIMENTO:**

1. Use um serviço de proxy pago confiável
2. Adicione no `.env`: `HTTP_PROXY=http://user:pass@proxy:port`
3. Reinicie o bot

## 📚 Referências

- [Best VPNs for Bybit 2026](https://cybernews.com/best-vpn/vpn-for-bybit/)
- [Bybit Restricted Countries](https://www.bitdegree.org/crypto/tutorials/bybit-restricted-countries)
- [Bybit API Guide](https://wundertrading.com/journal/en/learn/article/bybit-api)

---

**IMPORTANTE:**
- Nunca use proxies públicos gratuitos para trading real (risco de segurança)
- Bybit pode detectar e bloquear proxies conhecidos
- Usar VPN pode violar os Termos de Serviço da Bybit em algumas jurisdições
- Consulte as leis locais antes de usar VPN para acessar exchanges
