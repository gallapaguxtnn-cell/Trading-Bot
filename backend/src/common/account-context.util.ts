import { AccountContext, AccountRegion } from '../exchange/exchange-client.interface';
import { ResolvedCredentials } from './credentials-resolver.service';

export function toAccountContext(
  credentials: ResolvedCredentials,
  decryptedApiKey: string,
  decryptedApiSecret: string,
  decryptedPassphrase?: string | null,
): AccountContext {
  return {
    credentials: {
      apiKey: decryptedApiKey,
      apiSecret: decryptedApiSecret,
      passphrase: decryptedPassphrase ?? null,
    },
    mode: credentials.isTestnet ? 'DEMO' : 'REAL',
    region: (credentials.siteId as AccountRegion) ?? null,
  };
}
