jest.mock('../utils/okx-request.util', () => ({
  OkxRequestUtil: { get: jest.fn(), post: jest.fn() },
}));

import { OkxClientService, OkxApiError, translateOkxError } from './okx-client.service';
import { OkxRequestUtil } from '../utils/okx-request.util';
import { RateLimiterUtil } from '../utils/rate-limiter.util';
import { AccountContext } from './exchange-client.interface';

function makeCtx(overrides: Partial<AccountContext> = {}): AccountContext {
  return {
    credentials: { apiKey: 'key', apiSecret: 'secret', passphrase: 'pass' },
    mode: 'REAL',
    region: null,
    ...overrides,
  };
}

function okxOk(data: any) {
  return { data: { code: '0', msg: '', data } };
}

const INSTRUMENT_SUI = [{ instId: 'SUI-USDT-SWAP', lotSz: '1', minSz: '1', tickSz: '0.0001', ctVal: '1', ctMult: '1' }];

describe('OkxClientService (FASE 5 -- PLANO_INTEGRACAO_OKX)', () => {
  let client: OkxClientService;

  beforeEach(() => {
    jest.resetAllMocks();
    RateLimiterUtil.getInstance().clearCache();
    client = new OkxClientService();
  });

  describe('getSymbolRules', () => {
    it('converte lotSz/minSz de contratos para quantidade base usando ctVal*ctMult', async () => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(okxOk(INSTRUMENT_SUI));

      const rules = await client.getSymbolRules(makeCtx(), 'SUIUSDT');

      expect(rules).toEqual({ qtyStep: '1', priceTick: '0.0001', minQty: '1', minNotional: '5' });
      expect((OkxRequestUtil.get as jest.Mock).mock.calls[0][0]).toContain('instId=SUI-USDT-SWAP');
    });

    it('BTC-USDT-SWAP com ctVal=0.01: qtyStep/minQty convertidos para BTC, nao contratos', async () => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(
        okxOk([{ instId: 'BTC-USDT-SWAP', lotSz: '1', minSz: '1', tickSz: '0.1', ctVal: '0.01', ctMult: '1' }]),
      );

      const rules = await client.getSymbolRules(makeCtx(), 'BTCUSDT');

      expect(rules.qtyStep).toBe('0.01');
      expect(rules.minQty).toBe('0.01');
    });

    it('usa cache -- nao refaz a chamada HTTP na segunda vez', async () => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(okxOk(INSTRUMENT_SUI));

      await client.getSymbolRules(makeCtx(), 'SUIUSDT');
      await client.getSymbolRules(makeCtx(), 'SUIUSDT');

      expect(OkxRequestUtil.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPublicInstrumentInfo (PLANO_FIX_PROXY_407_OKX -- FASE 4: dados do instrumento na etapa publica do test-connection)', () => {
    it('devolve ctVal/ctMult/lotSz/minSz/tickSz crus (sem conversao), consultando so o endpoint publico', async () => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(okxOk(INSTRUMENT_SUI));

      const info = await client.getPublicInstrumentInfo(null, 'SUIUSDT');

      expect(info).toEqual({ ctVal: '1', ctMult: '1', lotSz: '1', minSz: '1', tickSz: '0.0001' });
      expect(OkxRequestUtil.get).toHaveBeenCalledTimes(1);
      expect((OkxRequestUtil.get as jest.Mock).mock.calls[0][0]).toContain('/api/v5/public/instruments');
      expect((OkxRequestUtil.get as jest.Mock).mock.calls[0][0]).toContain('instId=SUI-USDT-SWAP');
    });

    it('compartilha o mesmo cache de 1h usado por getSymbolRules (mesmo instId)', async () => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(okxOk(INSTRUMENT_SUI));

      await client.getSymbolRules(makeCtx(), 'SUIUSDT');
      await client.getPublicInstrumentInfo(null, 'SUIUSDT');

      expect(OkxRequestUtil.get).toHaveBeenCalledTimes(1);
    });

    it('propaga o erro quando o endpoint publico falha (proxy/rede) -- quem chama decide como classificar', async () => {
      const proxyError: any = new Error('Request failed with status code 407');
      proxyError.response = { status: 407 };
      (OkxRequestUtil.get as jest.Mock).mockRejectedValue(proxyError);

      await expect(client.getPublicInstrumentInfo(null, 'SUIUSDT')).rejects.toThrow('407');
    });
  });

  describe('createOrder', () => {
    beforeEach(() => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(okxOk(INSTRUMENT_SUI));
    });

    it('one-way mode MARKET: posSide=net, reduceOnly repassado, sz em contratos', async () => {
      (OkxRequestUtil.post as jest.Mock).mockResolvedValue(okxOk([{ ordId: '111', sCode: '0', sMsg: '' }]));

      const result = await client.createOrder(makeCtx(), {
        symbol: 'SUIUSDT', side: 'BUY', orderType: 'MARKET', qty: '60', reduceOnly: true,
      });

      expect(result).toEqual({ orderId: '111' });
      const body = (OkxRequestUtil.post as jest.Mock).mock.calls[0][1];
      expect(body).toMatchObject({ instId: 'SUI-USDT-SWAP', side: 'buy', ordType: 'market', sz: '60', posSide: 'net', reduceOnly: true, tdMode: 'cross' });
    });

    it('hedge mode LIMIT: posSide vem de positionSide (posicao original), nao do side transacional', async () => {
      (OkxRequestUtil.post as jest.Mock).mockResolvedValue(okxOk([{ ordId: '222', sCode: '0', sMsg: '' }]));

      await client.createOrder(makeCtx(), {
        symbol: 'SUIUSDT', side: 'SELL', orderType: 'LIMIT', qty: '60', price: '0.75',
        hedgeMode: true, positionSide: 'BUY',
      });

      const body = (OkxRequestUtil.post as jest.Mock).mock.calls[0][1];
      expect(body.side).toBe('sell');
      expect(body.posSide).toBe('long');
      expect(body.px).toBe('0.75');
      expect(body.ordType).toBe('limit');
    });

    it('quantidade convertida para 0 contratos -> lanca erro explicito antes de enviar a ordem', async () => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(
        okxOk([{ instId: 'SUI-USDT-SWAP', lotSz: '100', minSz: '100', tickSz: '0.0001', ctVal: '1', ctMult: '1' }]),
      );

      await expect(
        client.createOrder(makeCtx(), { symbol: 'SUIUSDT', side: 'BUY', orderType: 'MARKET', qty: '5' }),
      ).rejects.toThrow('convertida para 0 contratos');
      expect(OkxRequestUtil.post).not.toHaveBeenCalled();
    });

    it('sCode diferente de 0 (erro por-ordem) -> lanca OkxApiError traduzido, mesmo com code=0 no envelope externo', async () => {
      (OkxRequestUtil.post as jest.Mock).mockResolvedValue(okxOk([{ ordId: '', sCode: '51008', sMsg: 'Insufficient balance' }]));

      await expect(
        client.createOrder(makeCtx(), { symbol: 'SUIUSDT', side: 'BUY', orderType: 'MARKET', qty: '60' }),
      ).rejects.toThrow('Saldo insuficiente');
    });

    it('erro no envelope externo (code != 0) -> lanca OkxApiError antes mesmo de olhar o array data', async () => {
      (OkxRequestUtil.post as jest.Mock).mockResolvedValue({ data: { code: '50113', msg: 'Invalid signature', data: [] } });

      await expect(
        client.createOrder(makeCtx(), { symbol: 'SUIUSDT', side: 'BUY', orderType: 'MARKET', qty: '60' }),
      ).rejects.toThrow(OkxApiError);
    });
  });

  describe('createStopLossOrder', () => {
    it('ordem algo (conditional) com slTriggerPx e slOrdPx=-1', async () => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(okxOk(INSTRUMENT_SUI));
      (OkxRequestUtil.post as jest.Mock).mockResolvedValue(okxOk([{ algoId: '333', sCode: '0', sMsg: '' }]));

      const result = await client.createStopLossOrder(makeCtx(), 'SUIUSDT', 'SELL', '60', '0.8119', false);

      expect(result).toEqual({ orderId: '333' });
      const body = (OkxRequestUtil.post as jest.Mock).mock.calls[0][1];
      expect(body).toMatchObject({
        instId: 'SUI-USDT-SWAP', side: 'buy', ordType: 'conditional', sz: '60',
        slTriggerPx: '0.8119', slOrdPx: '-1', posSide: 'net', reduceOnly: true,
      });
    });

    it('hedge mode: posSide vem do lado original da posicao (side), nao do closeSide', async () => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(okxOk(INSTRUMENT_SUI));
      (OkxRequestUtil.post as jest.Mock).mockResolvedValue(okxOk([{ algoId: '444', sCode: '0', sMsg: '' }]));

      await client.createStopLossOrder(makeCtx(), 'SUIUSDT', 'BUY', '60', '0.75', true);

      const body = (OkxRequestUtil.post as jest.Mock).mock.calls[0][1];
      expect(body.side).toBe('sell');
      expect(body.posSide).toBe('long');
      expect(body.reduceOnly).toBeUndefined();
    });
  });

  describe('cancelOrder (algo primeiro, fallback para regular)', () => {
    it('sucesso no cancelamento algo -> retorna true sem tentar o regular', async () => {
      (OkxRequestUtil.post as jest.Mock).mockResolvedValueOnce(okxOk([{ sCode: '0', sMsg: '' }]));

      const result = await client.cancelOrder(makeCtx(), 'SUIUSDT', 'algo-1');

      expect(result).toBe(true);
      expect(OkxRequestUtil.post).toHaveBeenCalledTimes(1);
      expect((OkxRequestUtil.post as jest.Mock).mock.calls[0][0]).toContain('cancel-algos');
    });

    it('algo falha -> tenta cancelamento regular, sucesso retorna true', async () => {
      (OkxRequestUtil.post as jest.Mock)
        .mockResolvedValueOnce(okxOk([{ sCode: '51503', sMsg: 'algo order not found' }]))
        .mockResolvedValueOnce(okxOk([{ sCode: '0', sMsg: '' }]));

      const result = await client.cancelOrder(makeCtx(), 'SUIUSDT', 'reg-1');

      expect(result).toBe(true);
      expect((OkxRequestUtil.post as jest.Mock).mock.calls[1][0]).toContain('cancel-order');
    });

    it('ambos falham -> retorna false, nunca lanca', async () => {
      (OkxRequestUtil.post as jest.Mock)
        .mockRejectedValueOnce(new Error('algo down'))
        .mockRejectedValueOnce(new Error('regular down'));

      const result = await client.cancelOrder(makeCtx(), 'SUIUSDT', 'x-1');

      expect(result).toBe(false);
    });
  });

  describe('getPositions', () => {
    it('filtra posicoes zeradas e converte contratos de volta para quantidade base', async () => {
      (OkxRequestUtil.get as jest.Mock)
        .mockResolvedValueOnce(okxOk([
          { instId: 'SUI-USDT-SWAP', pos: '60', posSide: 'net', avgPx: '0.796', upl: '1.2', lever: '10', markPx: '0.80', liqPx: '0.5', notionalUsd: '48' },
          { instId: 'BTC-USDT-SWAP', pos: '0', posSide: 'net', avgPx: '0', upl: '0', lever: '10', markPx: '0' },
        ]))
        .mockResolvedValue(okxOk(INSTRUMENT_SUI));

      const positions = await client.getPositions(makeCtx());

      expect(positions).toHaveLength(1);
      expect(positions[0]).toMatchObject({ symbol: 'SUIUSDT', side: 'BUY', size: '60', avgPrice: '0.796' });
    });

    it('hedge mode: posSide short mapeia para SELL', async () => {
      (OkxRequestUtil.get as jest.Mock)
        .mockResolvedValueOnce(okxOk([
          { instId: 'SUI-USDT-SWAP', pos: '60', posSide: 'short', avgPx: '0.796', upl: '0', lever: '10', markPx: '0.80' },
        ]))
        .mockResolvedValue(okxOk(INSTRUMENT_SUI));

      const positions = await client.getPositions(makeCtx());

      expect(positions[0].side).toBe('SELL');
    });
  });

  describe('getWalletBalance', () => {
    it('usa availBal quando positivo', async () => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(
        okxOk([{ details: [{ ccy: 'USDT', availBal: '150.5', cashBal: '200' }] }]),
      );

      expect(await client.getWalletBalance(makeCtx())).toBe(150.5);
    });

    it('cai para cashBal quando availBal e 0', async () => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(
        okxOk([{ details: [{ ccy: 'USDT', availBal: '0', cashBal: '200' }] }]),
      );

      expect(await client.getWalletBalance(makeCtx())).toBe(200);
    });

    it('sem USDT na conta -> lanca erro explicito', async () => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(okxOk([{ details: [{ ccy: 'BTC', availBal: '1', cashBal: '1' }] }]));

      await expect(client.getWalletBalance(makeCtx())).rejects.toThrow('USDT');
    });
  });

  describe('getCurrentPrice / getLastTradePrice (publicos, sem headers de autenticacao)', () => {
    it('getCurrentPrice nao envia headers privados', async () => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(okxOk([{ last: '0.796' }]));

      const price = await client.getCurrentPrice(makeCtx(), 'SUIUSDT');

      expect(price).toBe(0.796);
      const config = (OkxRequestUtil.get as jest.Mock).mock.calls[0][1];
      expect(config).toBeUndefined();
    });

    it('getCurrentPrice em erro retorna 0 em vez de lancar', async () => {
      (OkxRequestUtil.get as jest.Mock).mockRejectedValue(new Error('network down'));

      expect(await client.getCurrentPrice(makeCtx(), 'SUIUSDT')).toBe(0);
    });

    it('getLastTradePrice le o preco do trade mais recente', async () => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(okxOk([{ px: '0.8015' }]));

      expect(await client.getLastTradePrice(makeCtx(), 'SUIUSDT')).toBe(0.8015);
    });
  });

  describe('trava de modo DEMO/REAL (FASE 4) integrada em toda requisicao privada', () => {
    it('mode DEMO -> header x-simulated-trading:1 presente na chamada real', async () => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(okxOk([{ details: [{ ccy: 'USDT', availBal: '10', cashBal: '10' }] }]));

      await client.getWalletBalance(makeCtx({ mode: 'DEMO' }));

      const config = (OkxRequestUtil.get as jest.Mock).mock.calls[0][1];
      expect(config.headers['x-simulated-trading']).toBe('1');
    });

    it('mode REAL -> header x-simulated-trading ausente na chamada real', async () => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(okxOk([{ details: [{ ccy: 'USDT', availBal: '10', cashBal: '10' }] }]));

      await client.getWalletBalance(makeCtx({ mode: 'REAL' }));

      const config = (OkxRequestUtil.get as jest.Mock).mock.calls[0][1];
      expect(config.headers['x-simulated-trading']).toBeUndefined();
    });

    it('todas as requisicoes privadas incluem OK-ACCESS-KEY/SIGN/TIMESTAMP/PASSPHRASE', async () => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(okxOk([{ details: [{ ccy: 'USDT', availBal: '10', cashBal: '10' }] }]));

      await client.getWalletBalance(makeCtx());

      const config = (OkxRequestUtil.get as jest.Mock).mock.calls[0][1];
      expect(config.headers['OK-ACCESS-KEY']).toBe('key');
      expect(config.headers['OK-ACCESS-PASSPHRASE']).toBe('pass');
      expect(typeof config.headers['OK-ACCESS-SIGN']).toBe('string');
      expect(typeof config.headers['OK-ACCESS-TIMESTAMP']).toBe('string');
    });
  });

  describe('dominio por regiao', () => {
    it.each([
      [null, 'https://www.okx.com'],
      ['EL_SALVADOR', 'https://www.okx.com'],
      ['EEA', 'https://eea.okx.com'],
      ['US', 'https://us.okx.com'],
    ])('region=%s -> %s', async (region, expectedHost) => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(okxOk([{ last: '1' }]));

      await client.getCurrentPrice(makeCtx({ region: region as any }), 'SUIUSDT');

      expect((OkxRequestUtil.get as jest.Mock).mock.calls[0][0]).toContain(expectedHost);
    });
  });

  describe('waitForPosition', () => {
    it('encontra a posicao na primeira tentativa', async () => {
      (OkxRequestUtil.get as jest.Mock)
        .mockResolvedValueOnce(okxOk([{ instId: 'SUI-USDT-SWAP', pos: '60', posSide: 'net', avgPx: '0.796', upl: '0', lever: '10', markPx: '0.8' }]))
        .mockResolvedValue(okxOk(INSTRUMENT_SUI));

      const found = await client.waitForPosition(makeCtx(), 'SUIUSDT', 'BUY', 3, 1);

      expect(found).toBe(true);
    });

    it('esgota as tentativas sem encontrar -> retorna false', async () => {
      (OkxRequestUtil.get as jest.Mock).mockResolvedValue(okxOk([]));

      const found = await client.waitForPosition(makeCtx(), 'SUIUSDT', 'BUY', 2, 1);

      expect(found).toBe(false);
    });
  });

  describe('setTradingStop / clearTradingStop (nao suportados, mesma familia de erro do Binance)', () => {
    it('setTradingStop lanca erro explicito', () => {
      expect(() => client.setTradingStop()).toThrow('nao e suportado pela OKX');
    });

    it('clearTradingStop lanca erro explicito', () => {
      expect(() => client.clearTradingStop()).toThrow('nao e suportado pela OKX');
    });
  });

  describe('getPositionIdx', () => {
    it('sempre retorna 0 (OKX usa posSide, nao indice numerico)', async () => {
      expect(await client.getPositionIdx()).toBe(0);
    });
  });
});

describe('translateOkxError (PLANO_FIX_PROXY_407_OKX -- FASE 2: erro de credencial nunca confundido com proxy/rede)', () => {
  it('50110 -> mensagem especifica de IP whitelist, nao generica', () => {
    expect(translateOkxError('50110', 'IP not in whitelist')).toBe(
      'API Key com IP whitelist: o IP de saida atual nao esta autorizado na OKX. Remova a restricao na chave ou adicione o IP do servidor.'
    );
  });

  it('50111 -> assinatura/API Key invalida', () => {
    expect(translateOkxError('50111', 'Invalid API Key')).toContain('assinatura ou header invalido');
  });

  it('50112 -> timestamp invalido', () => {
    expect(translateOkxError('50112', 'Timestamp expired')).toContain('Timestamp invalido');
  });

  it('50113 -> passphrase invalida', () => {
    expect(translateOkxError('50113', 'Invalid Sign')).toContain('Passphrase invalida');
  });

  it('codigo desconhecido -> mensagem generica com o codigo original preservado', () => {
    expect(translateOkxError('99999', 'algo raro')).toBe('Erro da OKX (codigo 99999): algo raro');
  });
});
