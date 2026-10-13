export interface ApiResponse<T = unknown> {
  statusCode: number;
  success: boolean;
  message: string;
  data: T | null;
}

export function createResponse<T>(statusCode: number, message: string, data?: T): ApiResponse<T> {
  return { statusCode, success: statusCode >= 200 && statusCode < 300, message, data: data ?? null };
}
