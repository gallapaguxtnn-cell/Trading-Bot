import * as crypto from 'crypto';
import { signOkxRequest, okxTimestamp } from './okx-signing.util';

describe('okx-signing.util (FASE 5/7 -- HMAC-SHA256 Base64 sobre timestamp+method+requestPath+body)', () => {
  it('reproduz exatamente o algoritmo documentado pela OKX: HMAC-SHA256(secret, timestamp+method+path+body) em Base64', () => {
    const secret = 'test-secret-key';
    const timestamp = '2020-12-08T09:08:57.715Z';
    const method = 'GET';
    const requestPath = '/api/v5/account/balance';
    const body = '';

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}${method}${requestPath}${body}`)
      .digest('base64');

    expect(signOkxRequest(secret, timestamp, method, requestPath, body)).toBe(expected);
  });

  it('inclui o body no prehash para requisicoes POST', () => {
    const secret = 'test-secret-key';
    const timestamp = '2020-12-08T09:08:57.715Z';
    const method = 'POST';
    const requestPath = '/api/v5/trade/order';
    const body = '{"instId":"SUI-USDT-SWAP","sz":"60"}';

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}${method}${requestPath}${body}`)
      .digest('base64');

    expect(signOkxRequest(secret, timestamp, method, requestPath, body)).toBe(expected);
  });

  it('normaliza o method para maiusculo (get e GET produzem a mesma assinatura)', () => {
    const secret = 's';
    const timestamp = '2020-12-08T09:08:57.715Z';
    expect(signOkxRequest(secret, timestamp, 'get', '/api/v5/account/balance', '')).toBe(
      signOkxRequest(secret, timestamp, 'GET', '/api/v5/account/balance', ''),
    );
  });

  it('timestamps, methods, paths ou bodies diferentes produzem assinaturas diferentes', () => {
    const base = signOkxRequest('secret', '2020-12-08T09:08:57.715Z', 'GET', '/api/v5/account/balance', '');
    expect(signOkxRequest('secret', '2020-12-08T09:08:57.716Z', 'GET', '/api/v5/account/balance', '')).not.toBe(base);
    expect(signOkxRequest('secret', '2020-12-08T09:08:57.715Z', 'POST', '/api/v5/account/balance', '')).not.toBe(base);
    expect(signOkxRequest('secret', '2020-12-08T09:08:57.715Z', 'GET', '/api/v5/trade/order', '')).not.toBe(base);
    expect(signOkxRequest('secret', '2020-12-08T09:08:57.715Z', 'GET', '/api/v5/account/balance', '{"a":1}')).not.toBe(base);
  });

  it('assinatura e uma string Base64 valida (44 caracteres para HMAC-SHA256, com padding)', () => {
    const sig = signOkxRequest('secret', okxTimestamp(), 'GET', '/api/v5/public/time', '');
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(sig.length).toBe(44);
  });

  it('okxTimestamp produz ISO 8601 UTC (formato exigido pela OKX, nao epoch ms)', () => {
    const ts = okxTimestamp();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
