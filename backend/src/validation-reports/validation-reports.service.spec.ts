import { ValidationReportsService } from './validation-reports.service';

describe('ValidationReportsService', () => {
  it('create persiste o certificado', async () => {
    const saved = { id: 'r1' };
    const repo = {
      create: jest.fn((x) => x),
      save: jest.fn().mockResolvedValue(saved),
      find: jest.fn().mockResolvedValue([]),
    } as any;
    const svc = new ValidationReportsService(repo);
    const out = await svc.create({ strategyId: 's1', report: { pairedPct: 100 }, configHash: 'h', engineVersion: '1.2.3' });
    expect(repo.create).toHaveBeenCalledWith({ strategyId: 's1', report: { pairedPct: 100 }, configHash: 'h', engineVersion: '1.2.3' });
    expect(out).toBe(saved);
  });

  it('findByStrategy filtra e ordena', async () => {
    const repo = { create: jest.fn(), save: jest.fn(), find: jest.fn().mockResolvedValue([{ id: 'r' }]) } as any;
    const svc = new ValidationReportsService(repo);
    await svc.findByStrategy('s1');
    expect(repo.find).toHaveBeenCalledWith({ where: { strategyId: 's1' }, order: { createdAt: 'DESC' }, take: 200 });
  });
});
