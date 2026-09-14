import { AccountContext, AccountRegion } from '../exchange/exchange-client.interface';
import { ResolvedCredentials } from './credentials-resolver.service';

export function toAccountContext(
  credentials: ResolvedCredentials,
  decryptedApiKey: string,
  decryptedApiSecret: string,
): AccountContext {
  return {
    credentials: {
      apiKey: decryptedApiKey,
      apiSecret: decryptedApiSecret,
    },
    mode: credentials.isTestnet ? 'DEMO' : 'REAL',
    region: (credentials.siteId as AccountRegion) ?? null,
  };
}
