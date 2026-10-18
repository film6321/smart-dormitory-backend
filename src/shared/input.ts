import { AppError } from '../middlewares/error-handler';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function requestBody(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new AppError('Request body must be an object', 400);
  return value;
}

export function text(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('Expected a text value', 400);
  return value;
}

export function optionalText(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : text(value);
}

export function booleanValue(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new AppError('Expected a boolean value', 400);
  return value;
}

export const isNumberArray = (value: unknown): value is number[] => Array.isArray(value)
  && value.every((entry: unknown) => typeof entry === 'number' && Number.isFinite(entry));

export const isNumberMatrix = (value: unknown): value is number[][] => Array.isArray(value)
  && value.every(isNumberArray);
