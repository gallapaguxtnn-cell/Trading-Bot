import { toAccountContext } from './account-context.util';
import { Exchange } from '../strategies/strategy.entity';
import { ResolvedCredentials } from './credentials-resolver.service';
import { EncryptionUtil } from '../utils/encryption.util';

jest.mock('../utils/encryption.util', () => ({
  EncryptionUtil: { decrypt: jest.fn(async (v: string) => v.replace(/^enc-/, 'plain-')) },
}));

function makeCredentials(overrides: Partial<ResolvedCredentials> = {}): ResolvedCredentials {
  return {
    apiKey: 'enc-key',
    apiSecret: 'enc-secret',
    apiPassphrase: null,
    exchange: Exchange.BYBIT,
    isTestnet: true,
    isRealAccount: false,
    portfolioId: null,
    siteId: null,
    source: 'strategy',
    ...overrides,
  };
}

describe('toAccountContext', () => {
  beforeEach(() => jest.clearAllMocks());

  it('isTestnet true -> mode DEMO; isTestnet false -> mode REAL', async () => {
    expect((await toAccountContext(makeCredentials({ isTestnet: true }), 'k', 's')).mode).toBe('DEMO');
    expect((await toAccountContext(makeCredentials({ isTestnet: false }), 'k', 's')).mode).toBe('REAL');
  });

  it('usa as credenciais decriptadas passadas, nao as (ainda criptografadas) do ResolvedCredentials', async () => {
    const ctx = await toAccountContext(makeCredentials({ apiKey: 'enc-key', apiSecret: 'enc-secret' }), 'plain-key', 'plain-secret');
    expect(ctx.credentials).toEqual({ apiKey: 'plain-key', apiSecret: 'plain-secret', passphrase: null });
  });

  it('decripta a passphrase a partir do ResolvedCredentials, sem depender do chamador', async () => {
    const ctx = await toAccountContext(makeCredentials({ apiPassphrase: 'enc-pass' }), 'k', 's');
    expect(ctx.credentials.passphrase).toBe('plain-pass');
    expect(EncryptionUtil.decrypt).toHaveBeenCalledWith('enc-pass');
  });

  it('OKX sem passphrase -> erro explicito, nunca requisicao que retornaria 50104', async () => {
    await expect(
      toAccountContext(makeCredentials({ exchange: Exchange.OKX, apiPassphrase: null }), 'k', 's'),
    ).rejects.toThrow(/passphrase/i);
  });

  it('OKX com passphrase -> contexto valido', async () => {
    const ctx = await toAccountContext(makeCredentials({ exchange: Exchange.OKX, apiPassphrase: 'enc-pass' }), 'k', 's');
    expect(ctx.credentials.passphrase).toBe('plain-pass');
  });

  it('siteId vira region; null continua null', async () => {
    expect((await toAccountContext(makeCredentials({ siteId: 'BRA_BTL' }), 'k', 's')).region).toBe('BRA_BTL');
    expect((await toAccountContext(makeCredentials({ siteId: null }), 'k', 's')).region).toBeNull();
  });
});
