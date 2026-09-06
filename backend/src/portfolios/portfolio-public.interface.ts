import { Exchange } from '../strategies/strategy.entity';
import { PortfolioMode } from './portfolio.entity';

export interface PortfolioPublic {
  id: string;
  name: string;
  exchange: Exchange;
  mode: PortfolioMode;
  isActive: boolean;
  apiKeyMasked: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioSummary {
  id: string;
  name: string;
  exchange: Exchange;
  mode: PortfolioMode;
}
