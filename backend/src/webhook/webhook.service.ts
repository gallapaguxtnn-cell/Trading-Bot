import { Injectable, Logger } from '@nestjs/common';
import { TradingviewSignalDto } from './dto/tradingview-signal.dto';
import { ExchangeService } from '../exchange/exchange.service';
import { StrategiesService } from '../strategies/strategies.service';
import { TradesService } from '../trades/trades.service';
import { Trade } from '../strategies/trade.entity';
import { Exchange } from '../strategies/strategy.entity';
import { EncryptionUtil } from '../utils/encryption.util';
import axios from 'axios';
import * as crypto from 'crypto';


@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly exchangeService: ExchangeService,
    private readonly strategiesService: StrategiesService,
    private readonly tradesService: TradesService
   ) {}

  private normalizeSymbol(symbol: string, exchange: Exchange): string {
    if (exchange === Exchange.BINANCE) {
      return symbol.replace('/', '').replace('-', '');
    } else if (exchange === Exchange.BYBIT) {
      return symbol.replace('/', '');
    }
    return symbol;
  }

  private formatQuantity(quantity: number, symbol: string): string {
    const quantityPrecision: { [key: string]: number } = {
      'BTCUSDT': 3,
      'ETHUSDT': 2,
      'BNBUSDT': 1,
      'ADAUSDT': 0,
      'SOLUSDT': 0,
    };

    const precision = quantityPrecision[symbol] || 3;
    return quantity.toFixed(precision);
  }

  private async getAccountBalance(strategy: any): Promise<number> {
    try {
      const decryptedKey = (await EncryptionUtil.decrypt(strategy.apiKey)).trim();
      const decryptedSecret = (await EncryptionUtil.decrypt(strategy.apiSecret)).trim();

      const exchange = strategy.exchange || Exchange.BINANCE;

      if (strategy.isTestnet && exchange === Exchange.BINANCE) {
        const baseURL = 'https://testnet.binancefuture.com/fapi/v2';
        const endpoint = '/balance';
        const timestamp = Date.now();
        const queryString = `timestamp=${timestamp}`;
        const signature = crypto.createHmac('sha256', decryptedSecret).update(queryString).digest('hex');

        const response = await axios.get(`${baseURL}${endpoint}?${queryString}&signature=${signature}`, {
          headers: { 'X-MBX-APIKEY': decryptedKey }
        });

        const usdtBalance = response.data.find((b: any) => b.asset === 'USDT');
        return parseFloat(usdtBalance?.availableBalance || '0');
      } else {
        const exchangeInstance = await this.exchangeService.getExchange(
          exchange,
          decryptedKey,
          decryptedSecret,
          strategy.isTestnet
        );

        const balance = await exchangeInstance.fetchBalance();
        return balance.free['USDT'] || 0;
      }
    } catch (error) {
      this.logger.error(`Failed to fetch account balance: ${error.message}`);
      return 0;
    }
  }

  async processSignal(signal: TradingviewSignalDto) {
    this.logger.log(`Processing signal: ${signal.action} ${signal.symbol} for Strategy ${signal.strategyId}`);

    if (!signal.strategyId) {
        throw new Error('Strategy ID is missing in signal');
    }
    const strategy = await this.strategiesService.findOne(signal.strategyId);
    if (!strategy) {
        throw new Error(`Strategy not found: ${signal.strategyId}`);
    }
    if (!strategy.isActive) {
        this.logger.warn(`Strategy ${strategy.name} is paused. Ignoring signal.`);
        return { status: 'skipped', message: 'Strategy is paused' };
    }

    const exchange = strategy.exchange || Exchange.BINANCE;
    const normalizedSymbol = this.normalizeSymbol(signal.symbol, exchange);

    // 2. Calculate Quantity
    let quantity: number;

    if (signal.quantity) {
        quantity = signal.quantity;
        this.logger.log(`Using explicit quantity from signal: ${quantity}`);
    } else if (signal.accountPercentage && signal.price) {
        const accountBalance = await this.getAccountBalance(strategy);
        quantity = (accountBalance * signal.accountPercentage / 100) / signal.price;
        this.logger.log(`Calculated quantity from ${signal.accountPercentage}% of balance: ${quantity}`);
    } else {
        quantity = strategy.defaultQuantity || 0.002;
        this.logger.log(`Using default quantity from strategy: ${quantity}`);
    }

    const tradeData: Partial<Trade> = {
        strategyId: strategy.id,
        symbol: normalizedSymbol,
        side: signal.action.toUpperCase() as 'BUY' | 'SELL',
        type: 'MARKET',
        entryPrice: signal.price,
        quantity: quantity,
        status: 'OPEN',
    };

    // 3. Dry Run Logic
    if (strategy.isDryRun) {
        this.logger.log(`[DRY RUN] Simulating ${signal.action} on ${signal.symbol}`);
        tradeData.status = 'SIMULATED';
        tradeData.pnl = 0; // No PnL for dry run yet
        await this.tradesService.create(tradeData);
        return { status: 'success', message: 'Dry Run Order Logged', trade: tradeData };
    }

    // 4. Real Execution
    try {
        const decryptedKey = (await EncryptionUtil.decrypt(strategy.apiKey)).trim();
        const decryptedSecret = (await EncryptionUtil.decrypt(strategy.apiSecret)).trim();


        this.logger.log(`[DEBUG] Decrypted Key (Start): ${decryptedKey ? decryptedKey.substring(0, 4) + '...' : 'UNDEFINED'}`);
        this.logger.log(`[DEBUG] Targeting Exchange: ${exchange} (Testnet: ${strategy.isTestnet})`);

        let tradeDetails: any;

        if (strategy.isTestnet && exchange === Exchange.BINANCE) {
             this.logger.log('[TESTNET BINANCE] Using Direct Axios Execution to bypass CCXT');
             
             const baseURL = 'https://testnet.binancefuture.com/fapi/v1';
             const endpoint = '/order';
             
             const params = new URLSearchParams();
             params.append('symbol', normalizedSymbol);
             params.append('side', signal.action.toUpperCase());
             params.append('type', 'MARKET');
             params.append('quantity', this.formatQuantity(quantity, normalizedSymbol));
             params.append('timestamp', Date.now().toString());

             const queryString = params.toString();
             const signature = crypto.createHmac('sha256', decryptedSecret).update(queryString).digest('hex');
             
             // Send as Form Data in Body
             const body = `${queryString}&signature=${signature}`;

             try {
                this.logger.log(`[REQUEST] POST ${baseURL}${endpoint}`);
                this.logger.log(`[REQUEST BODY] ${body}`);

                const response = await axios.post(`${baseURL}${endpoint}`, body, {
                    headers: {
                        'X-MBX-APIKEY': decryptedKey,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                });
                const data = response.data;

                this.logger.log(`[SUCCESS] Order Placed! Order ID: ${data.orderId}`);
                this.logger.log(`[RESPONSE] ${JSON.stringify(data)}`);

                const filledPrice = parseFloat(data.avgPrice || data.price || '0');
                const finalPrice = filledPrice > 0 ? filledPrice : signal.price;

                tradeDetails = {
                    id: data.orderId.toString(),
                    price: finalPrice,
                    average: finalPrice,
                    status: data.status
                };
             } catch (axiosError: any) {
                 const errorMsg = axiosError.response?.data?.msg || axiosError.response?.data || axiosError.message;
                 this.logger.error(`[ORDER FAILED] ${JSON.stringify(errorMsg)}`);
                 this.logger.error(`[ERROR DETAILS] Status: ${axiosError.response?.status}, Data: ${JSON.stringify(axiosError.response?.data)}`);
                 throw new Error(`Binance API Error: ${JSON.stringify(errorMsg)}`);
             }

        } else {
            const exchangeInstance = await this.exchangeService.getExchange(
                exchange,
                decryptedKey,
                decryptedSecret,
                strategy.isTestnet
            );

            const order = await exchangeInstance.createOrder(signal.symbol, 'market', signal.action, tradeData.quantity);
            this.logger.log(`[REAL] Order Placed via CCXT: ${order.id}`);
            tradeDetails = order;
        }
        
        tradeData.entryPrice = tradeDetails.average || tradeDetails.price || signal.price;
        tradeData.exchangeOrderId = tradeDetails.id;
        
        await this.tradesService.create(tradeData);

        return { status: 'success', message: 'Order Executed', trade: tradeData };

    } catch (error) {
        this.logger.error('Error executing real trade', error);
        tradeData.status = 'ERROR';
        tradeData.error = error.message;
        await this.tradesService.create(tradeData);
        return { status: 'error', message: error.message };
    }
  }
}
