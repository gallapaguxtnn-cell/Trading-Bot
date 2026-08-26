import axios from 'axios';
import { BybitClientService } from './bybit-client.service';

jest.mock('axios');

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

describe('BybitClientService (getSymbolRules minNotional)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('devolve o minNotionalValue vindo do lotSizeFilter da Bybit', async () => {
    (axios.get as jest.Mock).mockResolvedValueOnce({
      data: {
        retCode: 0,
        result: {
          list: [
            {
              lotSizeFilter: { qtyStep: '1', minOrderQty: '1', minNotionalValue: '5' },
              priceFilter: { tickSize: '0.0001' },
            },
          ],
        },
      },
    });

    const service = new BybitClientService(makeConfigService());
    const rules = await service.getSymbolRules(false, 'SUIUSDT');

    expect(rules).toEqual({ qtyStep: '1', priceTick: '0.0001', minQty: '1', minNotional: '5' });
  });

  it('usa fallback de 5 quando a corretora nao devolve minNotionalValue', async () => {
    (axios.get as jest.Mock).mockResolvedValueOnce({
      data: {
        retCode: 0,
        result: {
          list: [
            {
              lotSizeFilter: { qtyStep: '0.001', minOrderQty: '0.001' },
              priceFilter: { tickSize: '0.01' },
            },
          ],
        },
      },
    });

    const service = new BybitClientService(makeConfigService());
    const rules = await service.getSymbolRules(false, 'BTCUSDT');

    expect(rules.minNotional).toBe('5');
  });

  it('usa fallback de 5 quando a requisicao falha', async () => {
    (axios.get as jest.Mock).mockRejectedValueOnce(new Error('network error'));

    const service = new BybitClientService(makeConfigService());
    const rules = await service.getSymbolRules(false, 'BTCUSDT');

    expect(rules).toEqual({ qtyStep: '0.001', priceTick: '0.01', minQty: '0.001', minNotional: '5' });
  });
});
