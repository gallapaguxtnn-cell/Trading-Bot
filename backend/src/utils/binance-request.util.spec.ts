jest.mock('axios', () => ({
  request: jest.fn().mockResolvedValue({ data: {} }),
}));

import axios from 'axios';
import { BinanceRequestUtil } from './binance-request.util';
import { ProxyUtil } from './proxy.util';

describe('BinanceRequestUtil (PLANO_FIX_PROXY_407_OKX -- FASE 1)', () => {
  it('informa "binance" ao ProxyUtil.getAxiosConfig, preservando o roteamento pelo Geonix', async () => {
    const spy = jest.spyOn(ProxyUtil, 'getAxiosConfig');

    await BinanceRequestUtil.get('https://fapi.binance.com/fapi/v1/ping');

    expect(spy).toHaveBeenCalledWith('binance');
    expect(axios.request).toHaveBeenCalled();
    spy.mockRestore();
  });
});
