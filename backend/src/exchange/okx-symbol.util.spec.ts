import { toOkxInstId, fromOkxInstId, contractsFromQty, qtyFromContracts } from './okx-symbol.util';

describe('okx-symbol.util (FASE 5/7 -- conversao simbolo <-> instId e quantidade <-> contratos)', () => {
  describe('toOkxInstId / fromOkxInstId', () => {
    it('SUIUSDT <-> SUI-USDT-SWAP', () => {
      expect(toOkxInstId('SUIUSDT')).toBe('SUI-USDT-SWAP');
      expect(fromOkxInstId('SUI-USDT-SWAP')).toBe('SUIUSDT');
    });

    it('BTCUSDT <-> BTC-USDT-SWAP', () => {
      expect(toOkxInstId('BTCUSDT')).toBe('BTC-USDT-SWAP');
      expect(fromOkxInstId('BTC-USDT-SWAP')).toBe('BTCUSDT');
    });

    it('1000PEPEUSDT (base com digitos) <-> 1000PEPE-USDT-SWAP', () => {
      expect(toOkxInstId('1000PEPEUSDT')).toBe('1000PEPE-USDT-SWAP');
      expect(fromOkxInstId('1000PEPE-USDT-SWAP')).toBe('1000PEPEUSDT');
    });

    it('simbolo sem quote USDT -> lanca erro explicito', () => {
      expect(() => toOkxInstId('SUIUSDC')).toThrow('USDT');
    });

    it('instId com formato invalido -> lanca erro explicito', () => {
      expect(() => fromOkxInstId('SUIUSDT')).toThrow('invalido');
    });
  });

  describe('contractsFromQty / qtyFromContracts (ctVal/ctMult -- responsabilidade do client, nunca do chamador)', () => {
    it('SUI-USDT-SWAP: ctVal=1, ctMult=1, lotSz=1 -> 60 SUI = 60 contratos', () => {
      expect(contractsFromQty(60, 1, 1, 1)).toBe('60');
      expect(qtyFromContracts(60, 1, 1)).toBe('60');
    });

    it('BTC-USDT-SWAP: ctVal=0.01, ctMult=1, lotSz=1 -> 0.253 BTC = 25 contratos (floor pelo lotSz)', () => {
      expect(contractsFromQty(0.253, '0.01', 1, 1)).toBe('25');
      expect(qtyFromContracts(25, '0.01', 1)).toBe('0.25');
    });

    it('lotSz fracionario: ctVal=1, lotSz=0.1 -> arredonda para baixo no multiplo de 0.1', () => {
      expect(contractsFromQty(12.37, 1, 1, '0.1')).toBe('12.3');
    });

    it('quantidade abaixo de 1 contrato -> 0 contratos (nunca contrato negativo ou fracionado alem do lotSz)', () => {
      expect(contractsFromQty(0.4, 1, 1, 1)).toBe('0');
    });

    it('ctVal/ctMult zero -> lanca erro explicito em vez de dividir por zero silenciosamente', () => {
      expect(() => contractsFromQty(60, 0, 1, 1)).toThrow('ctVal/ctMult');
    });

    it('ida e volta (qty -> contratos -> qty) preserva o valor quando ja alinhado ao lotSz', () => {
      const contracts = contractsFromQty(0.05, '0.01', 1, 1);
      expect(contracts).toBe('5');
      expect(qtyFromContracts(contracts, '0.01', 1)).toBe('0.05');
    });
  });
});
