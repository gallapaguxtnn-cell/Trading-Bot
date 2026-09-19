import { classifyConnectionError } from './connection-error.util';

describe('classifyConnectionError (PLANO_FIX_PROXY_407_OKX -- FASE 2)', () => {
  it.each([407, 502, 503])('status HTTP %d -> classifica como PROXY', (status) => {
    const error: any = new Error(`Request failed with status code ${status}`);
    error.response = { status };

    const result = classifyConnectionError(error);

    expect(result?.kind).toBe('PROXY');
    expect(result?.message).toContain('PROXY');
    expect(result?.message).toContain(String(status));
  });

  it.each(['ECONNREFUSED', 'ETIMEDOUT'])('codigo de erro %s -> classifica como NETWORK', (code) => {
    const error: any = new Error('connect failed');
    error.code = code;

    const result = classifyConnectionError(error);

    expect(result?.kind).toBe('NETWORK');
    expect(result?.message).toContain('rede');
  });

  it('status HTTP 401/403 (credencial real) -> nao classifica, deixa a mensagem original passar', () => {
    const error: any = new Error('Invalid API Key');
    error.response = { status: 401 };

    expect(classifyConnectionError(error)).toBeNull();
  });

  it('erro sem response nem code (ex.: OkxApiError ja traduzido) -> nao classifica', () => {
    expect(classifyConnectionError(new Error('Passphrase invalida na OKX (codigo 50113): Invalid Sign'))).toBeNull();
  });

  it('erro nulo/undefined nao lanca excecao', () => {
    expect(classifyConnectionError(null)).toBeNull();
    expect(classifyConnectionError(undefined)).toBeNull();
  });
});
