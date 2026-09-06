import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Strategy, Exchange } from '../strategies/strategy.entity';
import { BinanceWebSocketService } from './binance-ws.service';
import { EncryptionUtil } from '../utils/encryption.util';
import { CredentialsResolverService } from '../common/credentials-resolver.service';

@Injectable()
export class BinanceWebSocketInitService implements OnModuleInit {
  private readonly logger = new Logger(BinanceWebSocketInitService.name);

  constructor(
    @InjectRepository(Strategy)
    private strategiesRepository: Repository<Strategy>,
    private binanceWs: BinanceWebSocketService,
    private credentialsResolver: CredentialsResolverService,
  ) {}

  async onModuleInit() {
    if (!this.binanceWs.isEnabled()) {
      this.logger.warn('[WS-INIT] Binance WebSocket is disabled - skipping initialization');
      return;
    }

    this.logger.log('[WS-INIT] Initializing WebSocket connections for active strategies');

    try {
      const strategies = await this.strategiesRepository
        .createQueryBuilder('strategy')
        .andWhere('strategy.isActive = :isActive', { isActive: true })
        .addSelect(['strategy.apiKey', 'strategy.apiSecret'])
        .getMany();

      this.logger.log(`[WS-INIT] Found ${strategies.length} active strategies (checking resolved exchange for each)`);

      for (const strategy of strategies) {
        try {
          const credentials = await this.credentialsResolver.resolveCredentials(strategy);
          const resolvedStrategy = { ...strategy, ...credentials };

          if (resolvedStrategy.exchange !== Exchange.BINANCE) {
            continue;
          }

          this.logger.debug(
            `[WS-INIT] Checking strategy ${resolvedStrategy.name} (ID: ${resolvedStrategy.id})`
          );
          this.logger.debug(
            `[WS-INIT]   - Has apiKey field: ${!!resolvedStrategy.apiKey} (length: ${resolvedStrategy.apiKey?.length || 0})`
          );
          this.logger.debug(
            `[WS-INIT]   - Has apiSecret field: ${!!resolvedStrategy.apiSecret} (length: ${resolvedStrategy.apiSecret?.length || 0})`
          );

          if (!resolvedStrategy.apiKey || !resolvedStrategy.apiSecret) {
            this.logger.warn(
              `[WS-INIT] Strategy ${resolvedStrategy.name} has no API credentials in database - skipping`
            );
            continue;
          }

          this.logger.debug(`[WS-INIT]   - Attempting to decrypt credentials...`);

          const apiKey = await EncryptionUtil.decrypt(resolvedStrategy.apiKey);
          const apiSecret = await EncryptionUtil.decrypt(resolvedStrategy.apiSecret);

          this.logger.debug(
            `[WS-INIT]   - Decryption result: apiKey=${!!apiKey}, apiSecret=${!!apiSecret}`
          );

          if (!apiKey || !apiSecret) {
            this.logger.warn(
              `[WS-INIT] Strategy ${resolvedStrategy.name} has invalid/corrupted API credentials - skipping`
            );
            continue;
          }

          await this.binanceWs.subscribeUserDataStream(
            resolvedStrategy.id,
            apiKey.trim(),
            apiSecret.trim(),
            resolvedStrategy.isTestnet,
          );

          this.logger.log(
            `[WS-INIT] ✅ Connected User Data Stream for strategy ${resolvedStrategy.name} (${resolvedStrategy.isTestnet ? 'testnet' : 'mainnet'})`
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
