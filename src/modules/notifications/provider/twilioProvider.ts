import https from 'https';

export async function send(provider: any, notification: any) {
  const config = provider?.config ? JSON.parse(provider.config) : {};
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber || !notification.recipientPhone) {
    const { send: fallbackSend } = await import('./simpleProvider');
    return fallbackSend(provider, notification);
  }

  const body = typeof notification.body === 'string' ? notification.body : JSON.stringify(notification.body ?? {});
  const data = new URLSearchParams({
    To: notification.recipientPhone,
    From: fromNumber,
    Body: body,
  });

  const options = {
    hostname: 'api.twilio.com',
    port: 443,
    path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
    method: 'POST',
    auth: `${accountSid}:${authToken}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(data.toString()),
    },
  };

  const providerMessageId = `twilio-${Date.now()}`;
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ id: providerMessageId, status: 'queued', raw, provider: 'twilio' });
        } else {
          reject(new Error(`Twilio request failed with ${res.statusCode}: ${raw}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data.toString());
    req.end();
  });
}

export default { send };
