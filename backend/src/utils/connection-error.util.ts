export interface ConnectionErrorClassification {
  kind: 'PROXY' | 'NETWORK';
  message: string;
}

const PROXY_ERROR_STATUSES = new Set([407, 502, 503]);
const NETWORK_ERROR_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT']);

export function classifyConnectionError(error: any): ConnectionErrorClassification | null {
  const status = error?.response?.status;
  if (typeof status === 'number' && PROXY_ERROR_STATUSES.has(status)) {
    return {
      kind: 'PROXY',
      message: `Falha no PROXY (HTTP ${status}) -- a requisicao nao chegou na corretora. Verifique PROXY_EXCHANGES ou a whitelist do provedor.`,
    };
  }

  const code = error?.code;
  if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) {
    return {
      kind: 'NETWORK',
      message: 'Nao foi possivel alcancar a corretora (rede).',
    };
  }

  return null;
}
