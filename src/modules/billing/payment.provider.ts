import { AppError } from '../../middlewares/error-handler';

export interface PaymentVerificationResult {
  success: boolean;
  recipientMatched: boolean;
  duplicate: boolean;
  amount: number | null;
  rawData: unknown;
  transactionId?: string;
  message?: string;
  retryable?: boolean;
}

interface PaymentProviderError {
  code?: string;
  message?: string;
}

interface PaymentProviderResponse {
  success?: boolean;
  message?: string;
  error?: string | PaymentProviderError;
  code?: string;
  matchedAccount?: unknown;
  data?: {
    isDuplicate?: boolean;
    matchedAccount?: unknown;
    rawSlip?: {
      transRef?: string;
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
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
};

const normalizeResponse = (payload: PaymentProviderResponse): PaymentVerificationResult => {
  const matchedAccount = payload.matchedAccount ?? payload.data?.matchedAccount;
  const rawAmount = payload.data?.rawSlip?.amount?.amount;
  const providerError = typeof payload.error === 'string' ? payload.error : payload.error?.message;
  const errorCode = typeof payload.error === 'object' && payload.error !== null ? payload.error.code : payload.code;
  const message = payload.message || providerError;
  const pendingSignal = `${message || ''} ${providerError || ''}`;

  return {
    success: payload.success === true && payload.data?.isDuplicate === false,
    recipientMatched: typeof matchedAccount === 'object' && matchedAccount !== null && !Array.isArray(matchedAccount) && Object.keys(matchedAccount).length > 0,
    duplicate: payload.data?.isDuplicate === true,
    amount: parseAmount(rawAmount),
    rawData: payload.data ?? payload,
    transactionId: typeof payload.data?.rawSlip?.transRef === 'string' ? payload.data.rawSlip.transRef.trim() || undefined : undefined,
    message,
    retryable: errorCode === 'SLIP_PENDING' || /bangkok bank slip is pending|slip is pending/i.test(pendingSignal),
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

    const result = normalizeResponse(payload);
    return { ...result, success: response.ok && result.success };
  }
}
