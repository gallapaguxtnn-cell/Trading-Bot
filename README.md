# Trading Bot

Automated cryptocurrency trading system with TradingView webhook integration for Binance and Bybit exchanges.

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
**Exchanges**: Binance, Bybit (Testnet & Production)

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
