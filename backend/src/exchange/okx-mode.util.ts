import { Logger } from '@nestjs/common';
import { AccountMode } from './exchange-client.interface';

const logger = new Logger('OKX');

export const OKX_SIMULATED_TRADING_HEADER = 'x-simulated-trading';

export class OkxModeMismatchError extends Error {
  constructor(mode: AccountMode, reason: string) {
    super(
      `[OKX] Divergencia critica de modo DEMO/REAL detectada (mode=${mode}): ${reason}. ` +
      `Abortando antes de enviar a requisicao -- nunca envia uma ordem com modo ambiguo.`
    );
    this.name = 'OkxModeMismatchError';
  }
}

/**
 * Unico ponto que decide o header x-simulated-trading a partir do AccountContext.mode.
 * Nunca deve ser passado por parametro solto em outro lugar do OkxClientService.
 */
export function buildSimulatedTradingHeaders(mode: AccountMode): Record<string, string> {
  return mode === 'DEMO' ? { [OKX_SIMULATED_TRADING_HEADER]: '1' } : {};
}

/**
 * Guarda em tempo de execucao: chamada antes de toda requisicao privada da OKX.
 * mode === 'DEMO' exige o header presente; mode === 'REAL' exige o header ausente.
 * Qualquer divergencia lanca OkxModeMismatchError e a requisicao nunca sai.
 */
export function assertModeHeaderConsistency(mode: AccountMode, headers: Record<string, string>): void {
  if (mode !== 'DEMO' && mode !== 'REAL') {
    throw new OkxModeMismatchError(mode, 'mode indefinido ou invalido -- nunca envia uma ordem sem saber se e DEMO ou REAL');
  }

  const hasSimulatedHeader = headers[OKX_SIMULATED_TRADING_HEADER] === '1';

  if (mode === 'DEMO' && !hasSimulatedHeader) {
    throw new OkxModeMismatchError(
      mode,
      `mode=DEMO mas o header ${OKX_SIMULATED_TRADING_HEADER} nao esta presente -- enviaria uma ordem DEMO para o ambiente REAL`
    );
  }

  if (mode === 'REAL' && hasSimulatedHeader) {
    throw new OkxModeMismatchError(
      mode,
      `mode=REAL mas o header ${OKX_SIMULATED_TRADING_HEADER} esta presente -- enviaria uma ordem REAL marcada como demo (ou o inverso)`
    );
  }
}

export function logOkxMode(mode: AccountMode, context: string): void {
  logger.log(`[OKX] ${context} mode=${mode}${mode === 'DEMO' ? ' simulated=1' : ''}`);
}
