import { Logger } from '@nestjs/common';
import {
  buildSimulatedTradingHeaders,
  assertModeHeaderConsistency,
  logOkxMode,
  OkxModeMismatchError,
  OKX_SIMULATED_TRADING_HEADER,
} from './okx-mode.util';

describe('okx-mode.util (FASE 4 -- trava de modo DEMO/REAL)', () => {
  describe('buildSimulatedTradingHeaders', () => {
    it('mode DEMO -> inclui x-simulated-trading: 1', () => {
      expect(buildSimulatedTradingHeaders('DEMO')).toEqual({ [OKX_SIMULATED_TRADING_HEADER]: '1' });
    });

    it('mode REAL -> nao inclui o header', () => {
      expect(buildSimulatedTradingHeaders('REAL')).toEqual({});
    });
  });

  describe('assertModeHeaderConsistency', () => {
    it('mode DEMO com o header presente -> nao lanca', () => {
      expect(() => assertModeHeaderConsistency('DEMO', { [OKX_SIMULATED_TRADING_HEADER]: '1' })).not.toThrow();
    });

    it('mode REAL sem o header -> nao lanca', () => {
      expect(() => assertModeHeaderConsistency('REAL', {})).not.toThrow();
    });

    it('mode DEMO SEM o header -> lanca OkxModeMismatchError e aborta (nunca envia)', () => {
      expect(() => assertModeHeaderConsistency('DEMO', {})).toThrow(OkxModeMismatchError);
    });

    it('mode REAL COM o header presente -> lanca OkxModeMismatchError e aborta', () => {
      expect(() => assertModeHeaderConsistency('REAL', { [OKX_SIMULATED_TRADING_HEADER]: '1' })).toThrow(OkxModeMismatchError);
    });

    it('mode DEMO com header de valor errado (nao "1") -> tratado como ausente, lanca', () => {
      expect(() => assertModeHeaderConsistency('DEMO', { [OKX_SIMULATED_TRADING_HEADER]: 'true' })).toThrow(OkxModeMismatchError);
    });

    it('a mensagem de erro identifica o mode e nunca sugere que a requisicao foi enviada', () => {
      try {
        assertModeHeaderConsistency('DEMO', {});
        fail('deveria ter lancado');
      } catch (e: any) {
        expect(e.message).toContain('mode=DEMO');
        expect(e.message).toContain('Abortando antes de enviar');
      }
    });
  });

  describe('logOkxMode (boot e cada criacao de ordem)', () => {
    it('mode DEMO -> loga "[OKX] <contexto> mode=DEMO simulated=1"', () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      logOkxMode('DEMO', 'boot');
      expect(logSpy).toHaveBeenCalledWith('[OKX] boot mode=DEMO simulated=1');
      logSpy.mockRestore();
    });

    it('mode REAL -> loga "[OKX] <contexto> mode=REAL" sem simulated', () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      logOkxMode('REAL', 'createOrder');
      expect(logSpy).toHaveBeenCalledWith('[OKX] createOrder mode=REAL');
      logSpy.mockRestore();
    });
  });

  describe('uso combinado (o padrao que o OkxClientService deve seguir antes de toda requisicao privada)', () => {
    it('fluxo correto: builder + assert nunca lancam juntos, para DEMO e para REAL', () => {
      for (const mode of ['DEMO', 'REAL'] as const) {
        const headers = buildSimulatedTradingHeaders(mode);
        expect(() => assertModeHeaderConsistency(mode, headers)).not.toThrow();
      }
    });

    it('nenhum caminho envia uma ordem com modo indefinido: mode undefined/invalido sempre lanca, com ou sem header', () => {
      const undefinedMode = undefined as unknown as 'DEMO' | 'REAL';
      expect(() => assertModeHeaderConsistency(undefinedMode, { [OKX_SIMULATED_TRADING_HEADER]: '1' })).toThrow(OkxModeMismatchError);
      expect(() => assertModeHeaderConsistency(undefinedMode, {})).toThrow(OkxModeMismatchError);
      expect(() => assertModeHeaderConsistency('SANDBOX' as unknown as 'DEMO' | 'REAL', {})).toThrow(OkxModeMismatchError);
    });
  });
});
