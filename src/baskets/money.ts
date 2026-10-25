import { AppError } from '../http/errors.js';

const MAX_SAFE_MONEY = BigInt(Number.MAX_SAFE_INTEGER);

export function moneyValue(value: number | string | bigint): number {
  const amount = typeof value === 'bigint' ? value : BigInt(value);
  if (amount < 0n || amount > MAX_SAFE_MONEY) throw new AppError(409, 'MONEY_LIMIT_EXCEEDED', 'The calculated amount exceeds the supported safe limit');
  return Number(amount);
}

export function multiplyMoney(unitMinor: number | string | bigint, quantity: number): number {
  return moneyValue(BigInt(unitMinor) * BigInt(quantity));
}

export function addMoney(values: Array<number | string | bigint>): number {
  return moneyValue(values.reduce<bigint>((total, value) => total + BigInt(value), 0n));
}

export function convertNgnToUsdMinor(ngnMinor: number, ngnMinorPerUsdMinor: number): number {
  if (!Number.isSafeInteger(ngnMinorPerUsdMinor) || ngnMinorPerUsdMinor <= 0) throw new AppError(409, 'INVALID_EXCHANGE_RATE', 'The indicative USD rate is invalid');
  const rate = BigInt(ngnMinorPerUsdMinor);
  return moneyValue((BigInt(ngnMinor) + rate / 2n) / rate);
}
