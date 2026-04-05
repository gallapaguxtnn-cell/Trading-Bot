import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Strategy, Exchange } from '../strategies/strategy.entity';
import { BinanceWebSocketService } from './binance-ws.service';
import { EncryptionUtil } from '../utils/encryption.util';

@Injectable()
export class BinanceWebSocketInitService implements OnModuleInit {
  private readonly logger = new Logger(BinanceWebSocketInitService.name);

  constructor(
    @InjectRepository(Strategy)
    private strategiesRepository: Repository<Strategy>,
    private binanceWs: BinanceWebSocketService,
  ) {}

  async onModuleInit() {
    if (!this.binanceWs.isEnabled()) {
      this.logger.warn('[WS-INIT] Binance WebSocket is disabled - skipping initialization');
      return;
    }

    this.logger.log('[WS-INIT] Initializing WebSocket connections for active strategies');

    try {
      const strategies = await this.strategiesRepository.find({
        where: {
          exchange: Exchange.BINANCE,
          isActive: true,
        },
      });

      this.logger.log(`[WS-INIT] Found ${strategies.length} active Binance strategies`);

      for (const strategy of strategies) {
        try {
          const apiKey = await EncryptionUtil.decrypt(strategy.apiKey);
          const apiSecret = await EncryptionUtil.decrypt(strategy.apiSecret);

          await this.binanceWs.subscribeUserDataStream(
            strategy.id,
            apiKey.trim(),
            apiSecret.trim(),
            strategy.isTestnet,
          );

          this.logger.log(
            `[WS-INIT] Connected User Data Stream for strategy ${strategy.name} (${strategy.isTestnet ? 'testnet' : 'mainnet'})`
          );
        } catch (error) {
          this.logger.error(
            `[WS-INIT] Failed to connect WebSocket for strategy ${strategy.name}: ${error.message}`
          );
        }
      }

      this.logger.log('[WS-INIT] WebSocket initialization completed');
    } catch (error) {
      this.logger.error(`[WS-INIT] Failed to initialize WebSockets: ${error.message}`);
    }
  }
}
