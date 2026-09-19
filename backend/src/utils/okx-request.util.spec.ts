jest.mock('axios', () => ({
  request: jest.fn().mockResolvedValue({ data: {} }),
}));

import axios from 'axios';
import { OkxRequestUtil } from './okx-request.util';
import { ProxyUtil } from './proxy.util';

describe('OkxRequestUtil (PLANO_FIX_PROXY_407_OKX -- FASE 1)', () => {
  it('informa "okx" ao ProxyUtil.getAxiosConfig, ficando fora da lista default e indo direto', async () => {
    const spy = jest.spyOn(ProxyUtil, 'getAxiosConfig');

    await OkxRequestUtil.get('https://www.okx.com/api/v5/public/time');

    expect(spy).toHaveBeenCalledWith('okx');
    expect(axios.request).toHaveBeenCalled();
    spy.mockRestore();
  });
});
