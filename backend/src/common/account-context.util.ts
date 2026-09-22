import { AccountContext, AccountRegion } from '../exchange/exchange-client.interface';
import { ResolvedCredentials } from './credentials-resolver.service';
import { Exchange } from '../strategies/strategy.entity';
import { EncryptionUtil } from '../utils/encryption.util';

export async function toAccountContext(
  credentials: ResolvedCredentials,
  decryptedApiKey: string,
  decryptedApiSecret: string,
): Promise<AccountContext> {
  const passphrase = credentials.apiPassphrase
    ? (await EncryptionUtil.decrypt(credentials.apiPassphrase)).trim()
    : null;

  if (credentials.exchange === Exchange.OKX && !passphrase) {
    throw new Error(
      '[OKX] Portfolio sem passphrase cadastrada. A OKX exige OK-ACCESS-PASSPHRASE em toda requisicao privada.',
    );
  }

  return {
    credentials: {
      apiKey: decryptedApiKey,
      apiSecret: decryptedApiSecret,
      passphrase,
    },
    mode: credentials.isTestnet ? 'DEMO' : 'REAL',
    region: (credentials.siteId as AccountRegion) ?? null,
  };
}
