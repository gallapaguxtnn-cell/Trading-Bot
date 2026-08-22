import { BybitClientService } from './bybit-client.service';

function makeConfigService(values: Record<string, string> = {}) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as any;
}

function getHeaders(service: BybitClientService) {
  return (service as any).getHeaders('key', 'secret', 'params');
}

describe('BybitClientService (header x-site-id)', () => {
  const originalEnv = process.env.BYBIT_SITE_ID;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BYBIT_SITE_ID;
    } else {
      process.env.BYBIT_SITE_ID = originalEnv;
    }
  });

  it('sem BYBIT_SITE_ID, headers ficam idênticos aos de hoje (zero regressão)', () => {
    delete process.env.BYBIT_SITE_ID;
    const service = new BybitClientService(makeConfigService());
    const headers = getHeaders(service);

    expect(Object.keys(headers).sort()).toEqual([
      'Content-Type',
      'X-BAPI-API-KEY',
      'X-BAPI-RECV-WINDOW',
      'X-BAPI-SIGN',
      'X-BAPI-TIMESTAMP',
    ]);
    expect(headers['x-site-id']).toBeUndefined();
  });

  it('com BYBIT_SITE_ID via ConfigService, inclui x-site-id no header', () => {
    delete process.env.BYBIT_SITE_ID;
    const service = new BybitClientService(makeConfigService({ BYBIT_SITE_ID: 'BRA_BTL' }));
    const headers = getHeaders(service);

    expect(headers['x-site-id']).toBe('BRA_BTL');
  });

  it('com BYBIT_SITE_ID via process.env (fallback), inclui x-site-id no header', () => {
    process.env.BYBIT_SITE_ID = 'BRA_BTL';
    const service = new BybitClientService(makeConfigService());
    const headers = getHeaders(service);

    expect(headers['x-site-id']).toBe('BRA_BTL');
  });

  it('x-site-id não entra na assinatura (HMAC inalterado)', () => {
    delete process.env.BYBIT_SITE_ID;
    const withoutSiteId = new BybitClientService(makeConfigService());
    const withSiteId = new BybitClientService(makeConfigService({ BYBIT_SITE_ID: 'BRA_BTL' }));

    const headersWithout = getHeaders(withoutSiteId);
    const headersWith = getHeaders(withSiteId);

    expect(headersWith['X-BAPI-SIGN']).toBe(headersWithout['X-BAPI-SIGN']);
  });
});

describe('BybitClientService (mensagem de erro retCode 10003)', () => {
  function formatRetMsg(service: BybitClientService, retCode: number | undefined, retMsg: string | undefined) {
    return (service as any).formatRetMsg(retCode, retMsg);
  }

  it('retCode 10003 acrescenta dica sobre BYBIT_SITE_ID', () => {
    const service = new BybitClientService(makeConfigService());
    const message = formatRetMsg(service, 10003, 'API key is invalid.');

    expect(message).toContain('API key is invalid.');
    expect(message).toContain('BYBIT_SITE_ID');
    expect(message).toContain('x-site-id');
  });

  it('outros retCodes não recebem a dica', () => {
    const service = new BybitClientService(makeConfigService());
    const message = formatRetMsg(service, 110043, 'leverage not modified');

    expect(message).toBe('leverage not modified');
  });
});
