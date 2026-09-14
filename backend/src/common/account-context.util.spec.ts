import { toAccountContext } from './account-context.util';
import { Exchange } from '../strategies/strategy.entity';
import { ResolvedCredentials } from './credentials-resolver.service';

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
  it('isTestnet true -> mode DEMO; isTestnet false -> mode REAL', () => {
    expect(toAccountContext(makeCredentials({ isTestnet: true }), 'k', 's').mode).toBe('DEMO');
    expect(toAccountContext(makeCredentials({ isTestnet: false }), 'k', 's').mode).toBe('REAL');
  });

  it('usa as credenciais decriptadas passadas, nao as (ainda criptografadas) do ResolvedCredentials', () => {
    const ctx = toAccountContext(makeCredentials({ apiKey: 'enc-key', apiSecret: 'enc-secret' }), 'plain-key', 'plain-secret');
    expect(ctx.credentials).toEqual({ apiKey: 'plain-key', apiSecret: 'plain-secret', passphrase: null });
  });

  it('passphrase decriptada e repassada quando informada', () => {
    const ctx = toAccountContext(makeCredentials({ apiPassphrase: 'enc-pass' }), 'k', 's', 'plain-pass');
    expect(ctx.credentials.passphrase).toBe('plain-pass');
  });

  it('siteId vira region; null continua null', () => {
    expect(toAccountContext(makeCredentials({ siteId: 'BRA_BTL' }), 'k', 's').region).toBe('BRA_BTL');
    expect(toAccountContext(makeCredentials({ siteId: null }), 'k', 's').region).toBeNull();
  });
});
