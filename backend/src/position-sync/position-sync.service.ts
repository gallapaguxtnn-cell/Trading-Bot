import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade } from '../strategies/trade.entity';
import { StrategiesService } from '../strategies/strategies.service';
import { ExchangeService } from '../exchange/exchange.service';
import { Exchange } from '../strategies/strategy.entity';
import { EncryptionUtil } from '../utils/encryption.util';
import axios from 'axios';

@Injectable()
export class PositionSyncService {
  private readonly logger = new Logger(PositionSyncService.name);
  private readonly BINANCE_TESTNET_URL = 'https://testnet.binancefuture.com/fapi/v1';

  constructor(
    @InjectRepository(Trade)
    private readonly tradesRepository: Repository<Trade>,
    private readonly strategiesService: StrategiesService,
    private readonly exchangeService: ExchangeService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async syncPositions(): Promise<void> {
    const openTrades = await this.tradesRepository.find({
      where: { status: 'OPEN' }
    });

    if (openTrades.length === 0) return;

    await Promise.all(
      openTrades.map(trade => this.syncTrade(trade).catch(error =>
        this.logger.error(`Failed to sync trade ${trade.id}: ${error.message}`)
      ))
    );
  }

  private async syncTrade(trade: Trade): Promise<void> {
    if (!trade.strategyId) return;

    const strategy = await this.strategiesService.findOne(trade.strategyId);
    if (!strategy?.isActive || strategy.isDryRun) return;

    const { apiKey, apiSecret } = await this.decryptCredentials(strategy);
    const exchange = strategy.exchange || Exchange.BINANCE;

    const currentPrice = await this.getCurrentPrice(
      trade.symbol,
      exchange,
      strategy.isTestnet,
      apiKey,
      apiSecret
    );

    const pnl = this.calculatePnL(
      parseFloat(trade.entryPrice as any),
      currentPrice,
      parseFloat(trade.quantity as any),
      trade.side
    );

    this.logSync(trade, currentPrice, pnl, exchange);

    trade.pnl = pnl as any;
    await this.tradesRepository.save(trade);
  }

  private async decryptCredentials(strategy: any) {
    const [apiKey, apiSecret] = await Promise.all([
      EncryptionUtil.decrypt(strategy.apiKey),
      EncryptionUtil.decrypt(strategy.apiSecret)
    ]);

    return {
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim()
    };
  }

  private async getCurrentPrice(
    symbol: string,
    exchange: Exchange,
    isTestnet: boolean,
    apiKey: string,
    apiSecret: string
  ): Promise<number> {
    if (isTestnet && exchange === Exchange.BINANCE) {
      return this.getBinanceTestnetPrice(symbol);
    }

    const exchangeInstance = await this.exchangeService.getExchange(
      exchange,
      apiKey,
      apiSecret,
      isTestnet
    );

    const ticker = await exchangeInstance.fetchTicker(symbol);
    return ticker.last;
  }

  private async getBinanceTestnetPrice(symbol: string): Promise<number> {
    const response = await axios.get(
      `${this.BINANCE_TESTNET_URL}/ticker/price?symbol=${symbol}`
    );
    return parseFloat(response.data.price);
  }

  private calculatePnL(
    entryPrice: number,
    currentPrice: number,
    quantity: number,
    side: 'BUY' | 'SELL'
  ): number {
    const priceDiff = side === 'BUY'
      ? currentPrice - entryPrice
      : entryPrice - currentPrice;

    return priceDiff * quantity;
  }

  private logSync(
    trade: Trade,
    currentPrice: number,
    pnl: number,
    exchange: Exchange
  ): void {
    const entryPrice = parseFloat(trade.entryPrice as any);
    const quantity = parseFloat(trade.quantity as any);

    this.logger.debug(
      `[SYNC ${exchange.toUpperCase()}] ${trade.symbol} ${trade.side} | ` +
      `Entry: ${entryPrice} | Current: ${currentPrice} | ` +
      `Qty: ${quantity} | P&L: ${pnl.toFixed(4)}`
    );
  }
}
