jest.mock('../utils/okx-request.util', () => ({
  OkxRequestUtil: { get: jest.fn(), post: jest.fn() },
}));

import { OkxClientService } from '../exchange/okx-client.service';
import { OkxRequestUtil } from '../utils/okx-request.util';
import { SymbolRulesService } from '../common/symbol-rules.service';
import { BybitClientService } from '../exchange/bybit-client.service';
import { RateLimiterUtil } from '../utils/rate-limiter.util';
import { planTakeProfits, buildEnabledTpConfigs } from './tp-planner.util';
import { Exchange } from '../strategies/strategy.entity';

function okxOk(data: any) {
  return { data: { code: '0', msg: '', data } };
}

describe('planTakeProfits com lotSz/minSz/ctVal reais da OKX (FASE 7 -- PLANO_INTEGRACAO_OKX)', () => {
  let symbolRulesService: SymbolRulesService;

  beforeEach(() => {
    jest.resetAllMocks();
    RateLimiterUtil.getInstance().clearCache();
    const okxClient = new OkxClientService();
    symbolRulesService = new SymbolRulesService({} as BybitClientService, okxClient);
  });

  it('BTC-USDT-SWAP (ctVal=0.01, lotSz=1): 3 TPs parciais somam exatamente a posicao em BTC, sem residuo', async () => {
    (OkxRequestUtil.get as jest.Mock).mockResolvedValue(
      okxOk([{ instId: 'BTC-USDT-SWAP', lotSz: '1', minSz: '1', tickSz: '0.1', ctVal: '0.01', ctMult: '1' }]),
    );

    const rules = await symbolRulesService.getSymbolRules('BTCUSDT', true, Exchange.OKX);
    expect(rules).toEqual({ qtyStep: '0.01', priceTick: '0.1', minQty: '0.01', minNotional: '5' });

    const strategy = {
      enableTakeProfit1: true, takeProfitPercentage1: 1, takeProfitQuantity1: 33,
      enableTakeProfit2: true, takeProfitPercentage2: 2, takeProfitQuantity2: 33,
      enableTakeProfit3: true, takeProfitPercentage3: 3, takeProfitQuantity3: 34,
    };
    const enabledTps = buildEnabledTpConfigs(strategy as any);

    const positionQty = 0.25;
    const entryPrice = 60000;
    const plan = planTakeProfits({
      quantity: positionQty,
      tps: enabledTps.map((tp) => ({
        id: tp.id,
        percent: tp.percent,
        qtyPercent: tp.qtyPercent,
        price: tp.id === 1 ? entryPrice * 1.01 : tp.id === 2 ? entryPrice * 1.02 : entryPrice * 1.03,
      })),
      qtyStep: rules.qtyStep,
      minQty: rules.minQty,
      minNotional: Number(rules.minNotional),
    });

    expect(plan.discarded).toEqual([]);
    expect(plan.planned).toHaveLength(3);

    const sum = plan.planned.reduce((acc, tp) => acc + Number(tp.quantity), 0);
    expect(sum).toBeCloseTo(positionQty, 2);

    for (const tp of plan.planned) {
      const decimals = tp.quantity.includes('.') ? tp.quantity.split('.')[1].length : 0;
      expect(decimals).toBeLessThanOrEqual(2);
    }
  });

  it('SUI-USDT-SWAP (ctVal=1, lotSz=1): TP com notional abaixo do minimo e descartado sem quebrar os demais', async () => {
    (OkxRequestUtil.get as jest.Mock).mockResolvedValue(
      okxOk([{ instId: 'SUI-USDT-SWAP', lotSz: '1', minSz: '1', tickSz: '0.0001', ctVal: '1', ctMult: '1' }]),
    );

    const rules = await symbolRulesService.getSymbolRules('SUIUSDT', true, Exchange.OKX);
    expect(rules).toEqual({ qtyStep: '1', priceTick: '0.0001', minQty: '1', minNotional: '5' });

    const plan = planTakeProfits({
      quantity: 20,
      tps: [
        { id: 1, percent: 1, qtyPercent: 90, price: 0.8 },
        { id: 2, percent: 2, qtyPercent: 10, price: 0.81 },
      ],
      qtyStep: rules.qtyStep,
      minQty: rules.minQty,
      minNotional: Number(rules.minNotional),
    });

    expect(plan.planned).toEqual([{ id: 1, percent: 1, quantity: '20' }]);
    expect(plan.discarded).toEqual([{ id: 2, percent: 2, reason: 'BELOW_MIN_NOTIONAL' }]);
  });

  it('mesma chamada duas vezes usa o cache da SymbolRulesService (OKX nao e consultada de novo)', async () => {
    (OkxRequestUtil.get as jest.Mock).mockResolvedValue(
      okxOk([{ instId: 'ETH-USDT-SWAP', lotSz: '1', minSz: '1', tickSz: '0.1', ctVal: '0.1', ctMult: '1' }]),
    );

    await symbolRulesService.getSymbolRules('ETHUSDT', true, Exchange.OKX);
    await symbolRulesService.getSymbolRules('ETHUSDT', true, Exchange.OKX);

    expect(OkxRequestUtil.get).toHaveBeenCalledTimes(1);
  });
});
