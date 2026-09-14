import Decimal from 'decimal.js';

export function toOkxInstId(symbol: string): string {
  if (!symbol.endsWith('USDT')) {
    throw new Error(`[OKX] Simbolo ${symbol} nao e um par USDT -- so perpetuos USDT-margined sao suportados.`);
  }
  const base = symbol.slice(0, -('USDT'.length));
  if (!base) {
    throw new Error(`[OKX] Simbolo ${symbol} invalido -- nao foi possivel extrair a moeda base.`);
  }
  return `${base}-USDT-SWAP`;
}

export function fromOkxInstId(instId: string): string {
  const parts = instId.split('-');
  if (parts.length < 2) {
    throw new Error(`[OKX] instId ${instId} invalido -- formato esperado BASE-QUOTE-SWAP.`);
  }
  return `${parts[0]}${parts[1]}`;
}

export function contractsFromQty(qty: string | number, ctVal: string | number, ctMult: string | number, lotSz: string | number): string {
  const dQty = new Decimal(qty);
  const dCtVal = new Decimal(ctVal);
  const dCtMult = new Decimal(ctMult);
  const dLotSz = new Decimal(lotSz);

  const unitSize = dCtVal.mul(dCtMult);
  if (unitSize.isZero()) {
    throw new Error('[OKX] ctVal/ctMult invalidos (zero) -- nao e possivel converter quantidade para contratos.');
  }

  const rawContracts = dQty.div(unitSize);
  const flooredContracts = dLotSz.isZero() ? rawContracts : rawContracts.div(dLotSz).floor().mul(dLotSz);

  return flooredContracts.toFixed();
}

export function qtyFromContracts(contracts: string | number, ctVal: string | number, ctMult: string | number): string {
  const dContracts = new Decimal(contracts);
  const dCtVal = new Decimal(ctVal);
  const dCtMult = new Decimal(ctMult);
  return dContracts.mul(dCtVal).mul(dCtMult).toFixed();
}
