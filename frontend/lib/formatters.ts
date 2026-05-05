export function formatPrice(price: number | string | null | undefined, prefix: string = '$'): string {
  if (price === null || price === undefined || price === '') return '-';

  const numValue = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(numValue)) return '-';

  const valueStr = typeof price === 'string' ? price : numValue.toString();

  return `${prefix}${valueStr}`;
}

export function formatQuantity(quantity: number | string | null | undefined): string {
  if (quantity === null || quantity === undefined || quantity === '') return '-';

  const numValue = typeof quantity === 'string' ? parseFloat(quantity) : quantity;
  if (isNaN(numValue)) return '-';

  const valueStr = typeof quantity === 'string' ? quantity : numValue.toString();

  return valueStr;
}

export function formatPnL(pnl: number | string | null | undefined, withSign: boolean = true): string {
  if (pnl === null || pnl === undefined || pnl === '') return '-';

  const numValue = typeof pnl === 'string' ? parseFloat(pnl) : pnl;
  if (isNaN(numValue)) return '-';

  const valueStr = typeof pnl === 'string' ? pnl : numValue.toString();
  const sign = withSign && numValue > 0 ? '+' : '';

  return `${sign}${valueStr}`;
}

export function formatPnLSummary(pnl: number | string | null | undefined, withSign: boolean = true): string {
  if (pnl === null || pnl === undefined || pnl === '') return '-';

  const numValue = typeof pnl === 'string' ? parseFloat(pnl) : pnl;
  if (isNaN(numValue)) return '-';

  const rounded = numValue.toFixed(2);
  const sign = withSign && numValue > 0 ? '+' : '';

  return `${sign}${rounded}`;
}

export function formatPercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';

  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(numValue)) return '-';

  const valueStr = typeof value === 'string' ? value : numValue.toString();

  return `${valueStr}%`;
}

export function formatPercentSummary(value: number | string | null | undefined, decimals: number = 1): string {
  if (value === null || value === undefined || value === '') return '-';

  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(numValue)) return '-';

  return `${numValue.toFixed(decimals)}%`;
}

export function formatDateUTC(date: Date | string | null | undefined): string {
  if (!date) return '-';

  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return '-';

  const year = dateObj.getUTCFullYear();
  const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function formatTimeUTC(date: Date | string | null | undefined): string {
  if (!date) return '-';

  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return '-';

  const hours = String(dateObj.getUTCHours()).padStart(2, '0');
  const minutes = String(dateObj.getUTCMinutes()).padStart(2, '0');
  const seconds = String(dateObj.getUTCSeconds()).padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

export function formatDateTimeUTC(date: Date | string | null | undefined): string {
  if (!date) return '-';

  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return '-';

  return `${formatDateUTC(dateObj)} ${formatTimeUTC(dateObj)} UTC`;
}

export function formatCloseReason(reason?: string | null): string {
  if (!reason) return '-';
  return reason.replace(/_/g, ' ');
}
