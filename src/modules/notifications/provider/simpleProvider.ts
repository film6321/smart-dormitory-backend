import { requestBody } from '../../../shared/input';
import type { Notification, NotificationProvider } from '@prisma/client';

export interface ProviderSendPayload extends Partial<Notification> {
  body?: string;
  recipientPhone?: string | null;
}

export interface ProviderSendResult {
  id: string;
  status: string;
  raw?: string;
  provider?: string;
}

export interface NotificationProviderModule {
  send(provider: NotificationProvider | null | undefined, notification: ProviderSendPayload): Promise<ProviderSendResult>;
}

export async function send(provider: NotificationProvider | null | undefined, _notification: ProviderSendPayload): Promise<ProviderSendResult> {
  const providerId = provider?.id ?? 'local-stub';
  await new Promise((r) => setTimeout(r, 5));

  try {
    const cfg = provider?.config ? requestBody(JSON.parse(provider.config)) : {};
    if (cfg.shouldFail) throw new Error('provider simulated failure');
  } catch (error) {
    if (error instanceof Error && error.message === 'provider simulated failure') {
      throw error;
    }
  }

  return { id: `stub-${providerId}-${Date.now()}`, status: 'ok' };
}

export default { send };
