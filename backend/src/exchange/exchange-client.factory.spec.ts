import { Test, TestingModule } from '@nestjs/testing';
import {
  ExchangeClientFactory,
  EXCHANGE_CLIENT_BYBIT,
  EXCHANGE_CLIENT_BINANCE,
  EXCHANGE_CLIENT_OKX,
} from './exchange-client.factory';
import { Exchange } from '../strategies/strategy.entity';
import { ExchangeClient } from './exchange-client.interface';

function makeFakeClient(): ExchangeClient {
  return {} as ExchangeClient;
}

describe('ExchangeClientFactory', () => {
  it('sem nenhum client registrado: get() lanca erro para qualquer corretora, has() devolve false', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExchangeClientFactory],
    }).compile();

    const factory = module.get<ExchangeClientFactory>(ExchangeClientFactory);

    expect(() => factory.get(Exchange.BYBIT)).toThrow(
      'Nenhum ExchangeClient registrado para bybit',
    );
    expect(() => factory.get(Exchange.BINANCE)).toThrow(
      'Nenhum ExchangeClient registrado para binance',
    );
    expect(() => factory.get(Exchange.OKX)).toThrow(
      'Nenhum ExchangeClient registrado para okx',
    );
    expect(factory.has(Exchange.BYBIT)).toBe(false);
  });

  it('com bybit e binance registrados: devolve a instancia certa para cada corretora, sem cruzar', async () => {
    const bybitClient = makeFakeClient();
    const binanceClient = makeFakeClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExchangeClientFactory,
        { provide: EXCHANGE_CLIENT_BYBIT, useValue: bybitClient },
        { provide: EXCHANGE_CLIENT_BINANCE, useValue: binanceClient },
      ],
    }).compile();

    const factory = module.get<ExchangeClientFactory>(ExchangeClientFactory);

    expect(factory.get(Exchange.BYBIT)).toBe(bybitClient);
    expect(factory.get(Exchange.BINANCE)).toBe(binanceClient);
    expect(factory.has(Exchange.OKX)).toBe(false);
    expect(() => factory.get(Exchange.OKX)).toThrow();
  });

  it('com okx registrado isoladamente: bybit e binance continuam sem client', async () => {
    const okxClient = makeFakeClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExchangeClientFactory,
        { provide: EXCHANGE_CLIENT_OKX, useValue: okxClient },
      ],
    }).compile();

    const factory = module.get<ExchangeClientFactory>(ExchangeClientFactory);

    expect(factory.get(Exchange.OKX)).toBe(okxClient);
    expect(factory.has(Exchange.BYBIT)).toBe(false);
    expect(factory.has(Exchange.BINANCE)).toBe(false);
  });
});
