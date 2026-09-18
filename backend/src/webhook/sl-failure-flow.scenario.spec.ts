import { withOneRetry } from './retry.util';
import { buildSlFailurePolicy, isCloseOnSlFailureEnabled } from './sl-failure-policy.util';

describe('Cenario de aceite: PLANO_FIX_PROTECAO_NAO_CRIADA (FASE 1 -- SL falha, retry, slWarnings, unprotectedSince, CLOSE_ON_SL_FAILURE)', () => {
  const noopSleep = async () => {};

  it('criacao de SL falha na 1a tentativa e se recupera no retry -> nenhum incidente, orderId normal (mesmo padrao do TP)', async () => {
    let attempts = 0;
    const createStopLossOrder = async () => {
      attempts++;
      if (attempts === 1) throw new Error('position not synced yet');
      return { orderId: 'sl-order-recovered' };
    };

    const order = await withOneRetry(() => createStopLossOrder(), noopSleep);

    expect(attempts).toBe(2);
    expect(order.orderId).toBe('sl-order-recovered');
  });

  it('criacao de SL falha nas duas tentativas -> retry esgotado, slWarnings gravado com o motivo da corretora e unprotectedSince marcado', async () => {
    const createStopLossOrder = async () => {
      throw new Error('retCode=110017: position idx not match position mode');
    };
    const fixedNow = new Date('2026-09-14T20:24:19.000Z');

    let slWarnings: string | null = null;
    let unprotectedSince: Date | null = null;

    try {
      await withOneRetry(() => createStopLossOrder(), noopSleep);
    } catch (slError: any) {
      ({ slWarnings, unprotectedSince } = buildSlFailurePolicy(slError.message, () => fixedNow));
    }

    expect(slWarnings).toBe('SL_CREATION_FAILED:retCode=110017: position idx not match position mode');
    expect(unprotectedSince).toBe(fixedNow);
  });

  it('CLOSE_ON_SL_FAILURE=false (default) -> posicao permanece aberta, so o alarme e gravado', async () => {
    let closedImmediately = false;
    let slWarnings: string | null = null;
    let unprotectedSince: Date | null = null;

    try {
      await withOneRetry(async () => { throw new Error('insufficient margin'); }, noopSleep);
    } catch (slError: any) {
      ({ slWarnings, unprotectedSince } = buildSlFailurePolicy(slError.message));
    }

    if (unprotectedSince && isCloseOnSlFailureEnabled({})) {
      closedImmediately = true;
    }

    expect(slWarnings).toBe('SL_CREATION_FAILED:insufficient margin');
    expect(unprotectedSince).not.toBeNull();
    expect(closedImmediately).toBe(false);
  });

  it('CLOSE_ON_SL_FAILURE=true -> aciona o fechamento imediato da posicao desprotegida', async () => {
    let closedImmediately = false;
    let unprotectedSince: Date | null = null;

    try {
      await withOneRetry(async () => { throw new Error('insufficient margin'); }, noopSleep);
    } catch (slError: any) {
      ({ unprotectedSince } = buildSlFailurePolicy(slError.message));
    }

    if (unprotectedSince && isCloseOnSlFailureEnabled({ CLOSE_ON_SL_FAILURE: 'true' })) {
      closedImmediately = true;
    }

    expect(closedImmediately).toBe(true);
  });

  it('SL criado com sucesso na 1a tentativa -> nenhum retry, nenhum slWarnings, unprotectedSince permanece null', async () => {
    let attempts = 0;
    const createStopLossOrder = async () => {
      attempts++;
      return { orderId: 'sl-order-ok' };
    };

    let slWarnings: string | null = null;
    let unprotectedSince: Date | null = null;

    try {
      await withOneRetry(() => createStopLossOrder(), noopSleep);
    } catch (slError: any) {
      ({ slWarnings, unprotectedSince } = buildSlFailurePolicy(slError.message));
    }

    expect(attempts).toBe(1);
    expect(slWarnings).toBeNull();
    expect(unprotectedSince).toBeNull();
  });
});
