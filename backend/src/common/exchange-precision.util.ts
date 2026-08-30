import Decimal from 'decimal.js';
import { Logger } from '@nestjs/common';

const logger = new Logger('ExchangePrecision');

export function normalizeQuantity(value: number, qtyStep: string, minQty: string): string {
  const dValue = new Decimal(value);
  const dStep = new Decimal(qtyStep);
  const dMinQty = new Decimal(minQty);

  if (dValue.lessThanOrEqualTo(0)) {
    logger.error(
      `[QUANTITY] INVALID - Input quantity is zero or negative\n` +
      `  Input Value: ${value}\n` +
      `  Step: ${qtyStep}\n` +
      `  Min Quantity: ${minQty}\n` +
      `  This will cause order creation to fail!`
    );
    throw new Error(`Invalid quantity: ${value}. Quantity must be greater than zero.`);
  }

  const rounded = dValue.div(dStep).floor().mul(dStep);

  if (rounded.isZero()) {
    logger.warn(
      `[QUANTITY] Rounded to zero - quantity too small\n` +
      `  Original: ${value} | Step: ${qtyStep} | MinQty: ${minQty}\n` +
      `  Returning '0' - caller should decide whether to skip or use minQty`
    );
    return '0';
  }

  if (rounded.lessThan(dMinQty)) {
    if (dValue.lessThan(dMinQty)) {
      logger.warn(
        `[QUANTITY] Original value ${value} < minQty ${minQty}\n` +
        `  Returning '0' - caller should decide whether to skip or use minQty`
      );
      return '0';
    }

    logger.warn(
      `[QUANTITY] Rounded below minimum but original was valid\n` +
      `  Original: ${value} | Rounded: ${rounded.toFixed()} | MinQty: ${minQty}\n` +
      `  Using minimum quantity`
    );
    return dMinQty.toFixed();
  }

  return rounded.toFixed();
}

export function roundPriceToTick(value: number, priceTick: string): string {
  const dValue = new Decimal(value);
  const dTick = new Decimal(priceTick);
  return dValue.div(dTick).round().mul(dTick).toFixed();
}

export function isMultipleOfStep(value: number | string, step: number | string): boolean {
  return new Decimal(value).mod(new Decimal(step)).isZero();
}
