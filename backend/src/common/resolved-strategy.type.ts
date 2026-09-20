import { Strategy } from '../strategies/strategy.entity';
import { ResolvedCredentials } from './credentials-resolver.service';

export type ResolvedStrategy = Omit<Strategy, 'exchange' | 'apiKey' | 'apiSecret' | 'isTestnet' | 'isRealAccount'> & ResolvedCredentials;
