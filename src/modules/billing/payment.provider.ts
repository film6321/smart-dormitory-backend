import { AppError } from '../../middlewares/error-handler';

export interface PaymentVerificationResult {
  success: boolean;
  recipientMatched: boolean;
  duplicate: boolean;
  amount: number | null;
  rawData: unknown;
  message?: string;
}

interface PaymentProviderResponse {
  success?: boolean;
  message?: string;
  error?: string;
  matchedAccount?: unknown;
  data?: {
    isDuplicate?: boolean;
    matchedAccount?: unknown;
    rawSlip?: {
      amount?: {
        amount?: number | string;
      };
    };
  };
}

const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, '');

const getTimeoutMs = (): number => {
  const configured = Number(process.env.PAYMENT_API_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 10_000;
};

const getPaymentApiUrl = (): string => {
  const configured = process.env.PAYMENT_API_URL?.trim();
  if (!configured) {
    throw new AppError('Payment Gateway is not configured. Please contact the administrator.', 503);
  }

  return normalizeBaseUrl(configured);
};

const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new AppError(error instanceof Error && error.name === 'AbortError'
      ? 'Payment Gateway timed out. Please try again later.'
      : 'Payment Gateway is unavailable. Please try again later.', 503);
  } finally {
    clearTimeout(timeout);
  }
};

const parseAmount = (value: number | string | undefined): number | null => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
};

const normalizeResponse = (payload: PaymentProviderResponse): PaymentVerificationResult => {
  const matchedAccount = payload.matchedAccount ?? payload.data?.matchedAccount;
  const rawAmount = payload.data?.rawSlip?.amount?.amount;

  return {
    success: payload.success === true,
    recipientMatched: matchedAccount !== null && matchedAccount !== undefined,
    duplicate: payload.data?.isDuplicate === true,
    amount: parseAmount(rawAmount),
    rawData: payload.data ?? payload,
    message: payload.message || payload.error,
  };
};

export class PaymentProviderClient {
  static async generateQr(amount: number): Promise<Buffer> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError('Payment amount must be greater than zero', 400);
    }

    const response = await fetchWithTimeout(
      `${getPaymentApiUrl()}/qrcode?amount=${encodeURIComponent(amount.toFixed(2))}`,
      { method: 'GET' },
    );

    if (!response.ok) {
      throw new AppError('Payment Gateway could not generate the QR code. Please try again later.', 503);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  static async verifySlip(file: { buffer: Buffer; mimetype: string; originalname: string }) {
    const formData = new FormData();
    const imageBytes = new Uint8Array(file.buffer.length);
    imageBytes.set(file.buffer);
    formData.append(
      'image',
      new Blob([imageBytes.buffer as ArrayBuffer], { type: file.mimetype || 'application/octet-stream' }),
      file.originalname || 'slip.jpg',
    );

    const response = await fetchWithTimeout(`${getPaymentApiUrl()}/upload`, {
      method: 'POST',
      body: formData,
    });
    const payload = (await response.json().catch(() => null)) as PaymentProviderResponse | null;

    if (!payload) {
      throw new AppError('Payment Gateway returned an invalid response. Please try again later.', 503);
    }

    if (response.status >= 500) {
      throw new AppError('Payment Gateway is unavailable. Please try again later.', 503);
    }

    return normalizeResponse(payload);
  }
}
