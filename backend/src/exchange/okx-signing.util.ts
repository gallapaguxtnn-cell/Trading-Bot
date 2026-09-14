import * as crypto from 'crypto';

export function okxTimestamp(): string {
  return new Date().toISOString();
}

export function signOkxRequest(
  secret: string,
  timestamp: string,
  method: string,
  requestPath: string,
  body: string,
): string {
  const prehash = `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
  return crypto.createHmac('sha256', secret).update(prehash).digest('base64');
}
