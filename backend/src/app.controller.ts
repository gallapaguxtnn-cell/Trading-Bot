import { Controller, Get, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { BinanceWebSocketService } from './binance-ws/binance-ws.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Strategy } from './strategies/strategy.entity';
import { EncryptionUtil } from './utils/encryption.util';
import axios from 'axios';
import * as crypto from 'crypto';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly binanceWs: BinanceWebSocketService,
    @InjectRepository(Strategy)
    private readonly strategiesRepository: Repository<Strategy>
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('/ip')
  async getPublicIP() {
    try {
      const response = await axios.get('https://api.ipify.org?format=json');
      return {
        ip: response.data.ip,
        timestamp: new Date().toISOString(),
        message: 'Use this IP to whitelist on Binance/Bybit API settings'
      };
    } catch (error) {
      return {
        error: 'Failed to fetch public IP',
        message: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Get('/health/websockets')
  getWebSocketHealth() {
    return {
      enabled: this.binanceWs.isEnabled(),
      ...this.binanceWs.getHealth(),
      timestamp: new Date().toISOString()
    };
  }

  @Get('/test/binance-ban')
  async testBinanceBan(@Query('strategyId') strategyId?: string) {
    try {
      const strategy = await this.strategiesRepository.findOne({
        where: { id: strategyId || '7059e1cb-20ea-450b-afb2-73871e010701' }
      });

      if (!strategy || !strategy.apiKey || !strategy.apiSecret) {
        return { error: 'Strategy not found or missing credentials' };
      }

      const apiKey = await EncryptionUtil.decrypt(strategy.apiKey);
      const apiSecret = await EncryptionUtil.decrypt(strategy.apiSecret);
      const baseURL = strategy.isTestnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';

      const timestamp = Date.now();
      const signature = crypto.createHmac('sha256', apiSecret).update(`timestamp=${timestamp}`).digest('hex');

      const response = await axios.post(
        `${baseURL}/fapi/v1/listenKey?timestamp=${timestamp}&signature=${signature}`,
        {},
        { headers: { 'X-MBX-APIKEY': apiKey } }
      );

      return {
        success: true,
        message: 'IP NOT BANNED! Listen key created successfully ✅',
        listenKey: response.data.listenKey,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      if (error.response?.status === 418) {
        const banUntil = error.response?.data?.retryAfter || error.response?.headers?.['retry-after'];
        return {
          success: false,
          banned: true,
          message: 'IP STILL BANNED ❌',
          error: error.response?.data,
          banUntilTimestamp: banUntil,
          timestamp: new Date().toISOString()
        };
      }

      return {
        success: false,
        error: error.message,
        details: error.response?.data,
        timestamp: new Date().toISOString()
      };
    }
  }
}
