import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { BinanceWebSocketService } from './binance-ws/binance-ws.service';
import axios from 'axios';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly binanceWs: BinanceWebSocketService
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
}
