import { IsString, IsNumber, IsOptional, IsEnum, IsBoolean } from 'class-validator';

export enum SignalAction {
  BUY = 'buy',
  SELL = 'sell',
}

export class TradingviewSignalDto {
  @IsString()
  secret: string;

  @IsString()
  symbol: string; // e.g., 'BTC/USDT'

  @IsEnum(SignalAction)
  action: SignalAction;

  @IsNumber()
  @IsOptional()
  price?: number;

  @IsString()
  @IsOptional()
  strategyId?: string;
  
  // Optional Strategy Overrides
  @IsNumber()
  @IsOptional()
  stopLoss?: number;

  @IsNumber()
  @IsOptional()
  takeProfit?: number;

  @IsNumber()
  @IsOptional()
  quantity?: number;

  @IsNumber()
  @IsOptional()
  accountPercentage?: number;
}
