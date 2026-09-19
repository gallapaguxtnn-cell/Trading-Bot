import { ProxyUtil } from './proxy.util';

describe('ProxyUtil (PLANO_FIX_PROXY_407_OKX -- FASE 1: proxy seletivo por corretora)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    ProxyUtil.initialize();
  });

  function setGeonixEnv() {
    process.env.GEONIX_PROXY_HOST = '1.2.3.4';
    process.env.GEONIX_PROXY_USER = 'user';
    process.env.GEONIX_PROXY_PASS = 'pass';
  }

  it('default (sem PROXY_EXCHANGES): Binance vai pelo proxy Geonix, OKX vai direto', () => {
    setGeonixEnv();
    delete process.env.PROXY_EXCHANGES;
    ProxyUtil.initialize();

    const binanceConfig = ProxyUtil.getAxiosConfig('binance');
    const okxConfig = ProxyUtil.getAxiosConfig('okx');

    expect(binanceConfig.httpsAgent).toBeDefined();
    expect(binanceConfig.proxy).toBe(false);
    expect(okxConfig).toEqual({});
  });

  it('PROXY_EXCHANGES=binance,okx: a OKX volta a usar o proxy Geonix', () => {
    setGeonixEnv();
    process.env.PROXY_EXCHANGES = 'binance,okx';
    ProxyUtil.initialize();

    expect(ProxyUtil.getAxiosConfig('okx').httpsAgent).toBeDefined();
    expect(ProxyUtil.getAxiosConfig('binance').httpsAgent).toBeDefined();
  });

  it('PROXY_EXCHANGES=okx: inverte o padrao -- Binance passa a ir direto', () => {
    setGeonixEnv();
    process.env.PROXY_EXCHANGES = 'okx';
    ProxyUtil.initialize();

    expect(ProxyUtil.getAxiosConfig('okx').httpsAgent).toBeDefined();
    expect(ProxyUtil.getAxiosConfig('binance')).toEqual({});
  });

  it('sem credenciais Geonix configuradas: ambas vao direto, independente de PROXY_EXCHANGES', () => {
    delete process.env.GEONIX_PROXY_HOST;
    delete process.env.GEONIX_PROXY_USER;
    delete process.env.GEONIX_PROXY_PASS;
    process.env.PROXY_EXCHANGES = 'binance,okx';
    ProxyUtil.initialize();

    expect(ProxyUtil.getAxiosConfig('binance')).toEqual({});
    expect(ProxyUtil.getAxiosConfig('okx')).toEqual({});
    expect(ProxyUtil.isEnabled()).toBe(false);
  });

  it('lista com espacos e maiusculas (" Binance , OKX ") e normalizada corretamente', () => {
    setGeonixEnv();
    process.env.PROXY_EXCHANGES = ' Binance , OKX ';
    ProxyUtil.initialize();

    expect(ProxyUtil.getAxiosConfig('binance').httpsAgent).toBeDefined();
    expect(ProxyUtil.getAxiosConfig('okx').httpsAgent).toBeDefined();
  });

  it('usesProxy reflete a mesma politica de getAxiosConfig', () => {
    setGeonixEnv();
    delete process.env.PROXY_EXCHANGES;
    ProxyUtil.initialize();

    expect(ProxyUtil.usesProxy('binance')).toBe(true);
    expect(ProxyUtil.usesProxy('okx')).toBe(false);
    expect(ProxyUtil.usesProxy('bybit')).toBe(false);
  });

  it('nunca loga a credencial do proxy em texto puro', () => {
    setGeonixEnv();
    process.env.GEONIX_PROXY_PASS = 'super-secret-pass';
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    ProxyUtil.initialize();

    const allLogs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allLogs).not.toContain('super-secret-pass');

    logSpy.mockRestore();
  });
});

describe('ProxyUtil (PLANO_FIX_PROXY_407_OKX -- FASE 5: robustez do proxy com senha contendo caracteres especiais)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    ProxyUtil.initialize();
  });

  it.each([
    ['@ : # % /', '@:#%/'],
    ['senha com espaco', 'senha com espaco'],
    ['p@ss:w0rd#123%off/path', 'p@ss:w0rd#123%off/path'],
  ])('senha "%s" produz uma URL de proxy valida que decodifica de volta para a senha original', (_label, rawPass) => {
    process.env.GEONIX_PROXY_HOST = '1.2.3.4';
    process.env.GEONIX_PROXY_USER = 'geonix-user';
    process.env.GEONIX_PROXY_PASS = rawPass;
    ProxyUtil.initialize();

    const proxyUrl = ProxyUtil.getProxyUrl();
    const parsed = new URL(proxyUrl);

    expect(decodeURIComponent(parsed.username)).toBe('geonix-user');
    expect(decodeURIComponent(parsed.password)).toBe(rawPass);
    expect(parsed.hostname).toBe('1.2.3.4');
  });

  it('usuario com caractere especial (@) tambem e codificado corretamente', () => {
    process.env.GEONIX_PROXY_HOST = '1.2.3.4';
    process.env.GEONIX_PROXY_USER = 'user@domain';
    process.env.GEONIX_PROXY_PASS = 'pass';
    ProxyUtil.initialize();

    const parsed = new URL(ProxyUtil.getProxyUrl());

    expect(decodeURIComponent(parsed.username)).toBe('user@domain');
  });

  it('Binance continua funcionando (getAxiosConfig devolve o httpsAgent) mesmo com senha especial', () => {
    process.env.GEONIX_PROXY_HOST = '1.2.3.4';
    process.env.GEONIX_PROXY_USER = 'geonix-user';
    process.env.GEONIX_PROXY_PASS = 'p@ss:w0rd#123%off/path';
    delete process.env.PROXY_EXCHANGES;
    ProxyUtil.initialize();

    expect(ProxyUtil.isEnabled()).toBe(true);
    expect(ProxyUtil.getAxiosConfig('binance').httpsAgent).toBeDefined();
  });
});
