import { Strategy } from '../strategies/strategy.entity';
import { ResolvedCredentials } from './credentials-resolver.service';

export type ResolvedStrategy = Omit<Strategy, 'legacyExchange' | 'legacyApiKey' | 'legacyApiSecret' | 'legacyIsTestnet' | 'legacyIsRealAccount'> & ResolvedCredentials;
