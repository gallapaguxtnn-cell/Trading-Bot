import { buildSlFailurePolicy, isCloseOnSlFailureEnabled } from './sl-failure-policy.util';

describe('buildSlFailurePolicy (PLANO_FIX_PROTECAO_NAO_CRIADA -- FASE 1: falha de SL vira incidente, nao log)', () => {
  it('grava slWarnings com o motivo da corretora e unprotectedSince com o instante da falha', () => {
    const fixedNow = new Date('2026-09-14T20:24:19.000Z');
    const policy = buildSlFailurePolicy('retCode=110017: position idx not match position mode', () => fixedNow);

    expect(policy.slWarnings).toBe('SL_CREATION_FAILED:retCode=110017: position idx not match position mode');
    expect(policy.unprotectedSince).toBe(fixedNow);
  });

  it('usa Date real por padrao quando nenhum clock e injetado', () => {
    const before = Date.now();
    const policy = buildSlFailurePolicy('timeout');
    const after = Date.now();

    expect(policy.unprotectedSince.getTime()).toBeGreaterThanOrEqual(before);
    expect(policy.unprotectedSince.getTime()).toBeLessThanOrEqual(after);
  });
});

describe('isCloseOnSlFailureEnabled (CLOSE_ON_SL_FAILURE, default false)', () => {
  it('default (variavel ausente) -> false, mantem a posicao aberta com alarme', () => {
    expect(isCloseOnSlFailureEnabled({})).toBe(false);
  });

  it('CLOSE_ON_SL_FAILURE=true -> true, fecha a posicao imediatamente', () => {
    expect(isCloseOnSlFailureEnabled({ CLOSE_ON_SL_FAILURE: 'true' })).toBe(true);
  });

  it('CLOSE_ON_SL_FAILURE=false (explicito) -> false', () => {
    expect(isCloseOnSlFailureEnabled({ CLOSE_ON_SL_FAILURE: 'false' })).toBe(false);
  });

  it('qualquer valor que nao seja a string "true" (ex.: "1", "TRUE") -> false -- so a string exata liga a politica', () => {
    expect(isCloseOnSlFailureEnabled({ CLOSE_ON_SL_FAILURE: '1' })).toBe(false);
    expect(isCloseOnSlFailureEnabled({ CLOSE_ON_SL_FAILURE: 'TRUE' })).toBe(false);
  });
});
