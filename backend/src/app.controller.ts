import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import axios from 'axios';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

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
}
