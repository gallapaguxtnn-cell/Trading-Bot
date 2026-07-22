import { getMetadataArgsStorage } from 'typeorm';
import { Strategy } from './strategy.entity';

describe('Strategy — segredos nunca retornados pelo GET /strategies', () => {
  const cols = getMetadataArgsStorage().columns.filter((c) => c.target === Strategy);
  const col = (name: string) => cols.find((c) => c.propertyName === name);

  it('apiKey é select:false', () => {
    expect(col('apiKey')?.options.select).toBe(false);
  });

  it('apiSecret é select:false', () => {
    expect(col('apiSecret')?.options.select).toBe(false);
  });

  it('a config de execução necessária está presente na entity', () => {
    for (const field of ['leverage', 'marginMode', 'stopLossPercentage', 'takeProfitPercentage1', 'allowAveraging', 'hedgeMode', 'direction', 'asset']) {
      expect(col(field)).toBeTruthy();
    }
  });
});
