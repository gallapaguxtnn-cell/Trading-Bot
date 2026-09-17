# Trading Bot

Automated cryptocurrency trading system with TradingView webhook integration for Binance, Bybit and OKX exchanges.

## Quick Start

```bash
docker-compose up -d
cd backend && npm install && npm run start:dev
cd ../frontend && npm install && npm run dev
```

Access:
- Dashboard: http://localhost:3000
- Backend API: http://localhost:4000

## Architecture

**Backend**: NestJS + TypeORM + PostgreSQL
**Frontend**: Next.js + React
**Exchanges**: Binance, Bybit, OKX (Testnet/Demo & Production — ver seção OKX abaixo)

## Environment Variables

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=admin
DB_PASSWORD=admin123
DB_NAME=trading_bot
WEBHOOK_SECRET=default_secret_123
ENCRYPTION_KEY=your-32-char-key
PORT=4000
```

## OKX

A integração com a OKX segue `PLANO_INTEGRACAO_OKX.md` e `PLANO_OKX_CONTA_REAL.md`.
A OKX é uma corretora de primeira classe no bot, igual a Bybit e Binance — não
existe flag nem tratamento especial: cadastre o portfólio (Demo ou Real) e opere.

### Como criar a API Key na OKX (com passphrase)

1. Crie/acesse uma conta em [okx.com](https://www.okx.com).
2. Para testar sem dinheiro real, ative o **Demo Trading** no menu de perfil
   (é o mesmo domínio `www.okx.com`, só muda um header nas requisições —
   não existe um subdomínio de testnet separado como na Binance/Bybit).
3. Vá em **Profile → API** e crie uma API Key. A OKX pede três valores, não
   dois: **API Key**, **Secret Key** e **Passphrase** (você define a
   passphrase na hora de criar — anote, não tem como recuperar depois). Marque
   a permissão **Trade**.
4. Escolha a **entidade/região** da conta. Para o padrão "conta El Salvador"
   (1 login, 2 contas — a mesma lógica da Bybit Brasil/Argentina), não é
   necessário nenhum passo extra: a região `EL_SALVADOR` no formulário do
   portfólio usa o domínio global padrão (`www.okx.com`). Contas européias ou
   americanas usam `EEA`/`US`, que roteiam para `eea.okx.com`/`us.okx.com`.
5. No formulário de portfólio do bot, selecione a corretora OKX, preencha API
   Key, Secret Key, Passphrase e a Entidade/Região, e use "Testar conexão"
   para confirmar o saldo antes de vincular qualquer estratégia.

## TradingView Webhook

**URL**: `https://your-domain.com/api/webhooks/tradingview`

**Payload**:
```json
{
  "secret": "default_secret_123",
  "strategyId": "your-strategy-id",
  "symbol": "{{ticker}}",
  "action": "{{strategy.order.action}}",
  "price": "{{close}}"
}
```

## API Endpoints

### Webhook
- `POST /api/webhooks/tradingview` - Receive TradingView signals
- `GET /api/webhooks/tradingview/health` - Health check

### Trades
- `GET /api/trades` - List trades (limit 50)
- `GET /api/trades/stats` - Get statistics

### Strategies
- `GET /api/strategies` - List strategies
- `POST /api/strategies` - Create strategy

## Dashboard Metrics

**Total P&L**: Realized + Unrealized profit/loss
**Win Rate**: Percentage of profitable closed trades
**Realized P&L**: Profit from closed positions
**Unrealized P&L**: Current P&L of open positions

## Background Services

- **Position Sync**: Updates P&L every 10 seconds
- **Stop-Loss**: Monitors and closes positions every 5 seconds
- **Take-Profit**: Executes partial closes every 5 seconds

## Production Checklist

- [ ] Set `WEBHOOK_SECRET` and `ENCRYPTION_KEY`
- [ ] Configure production API keys
- [ ] Set `isTestnet: false` in strategy
- [ ] Set `isDryRun: false` to enable real trading
- [ ] Configure stop-loss and take-profit
- [ ] Test with minimum quantities first

## System Requirements

- Node.js 20+
- Docker & Docker Compose
- PostgreSQL 15+
- Exchange testnet accounts for testing

## Links

- [Binance Futures Testnet](https://testnet.binancefuture.com)
- [Bybit Testnet](https://testnet.bybit.com)
- [OKX](https://www.okx.com) (ative "Demo Trading" no menu de perfil)
