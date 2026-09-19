import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

const KNOWN_PROXY_ELIGIBLE_EXCHANGES = ['binance', 'okx'];

export class ProxyUtil {
  private static httpsAgent: HttpsProxyAgent<string> | null = null;
  private static socksAgent: SocksProxyAgent | null = null;
  private static enabled: boolean = false;
  private static proxyUrl: string = '';
  private static proxyExchanges: Set<string> = new Set();

  static initialize() {
    const configuredExchanges = (process.env.PROXY_EXCHANGES || 'binance')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    this.proxyExchanges = new Set(configuredExchanges);

    const direct = KNOWN_PROXY_ELIGIBLE_EXCHANGES.filter((e) => !this.proxyExchanges.has(e));
    console.log(
      `[PROXY] Geonix ativo para: ${[...this.proxyExchanges].join(', ') || '(nenhuma)'} | ` +
      `direto: ${direct.join(', ') || '(nenhuma)'} | bybit usa HTTP_PROXY`
    );

    const geonixHost = process.env.GEONIX_PROXY_HOST;
    const geonixUser = process.env.GEONIX_PROXY_USER;
    const geonixPass = process.env.GEONIX_PROXY_PASS;
    const geonixHttpPort = process.env.GEONIX_PROXY_HTTP_PORT || '59100';
    const geonixSocksPort = process.env.GEONIX_PROXY_SOCKS_PORT || '59101';

    if (!geonixHost || !geonixUser || !geonixPass) {
      this.enabled = false;
      console.log('[PROXY] Proxy não configurado - rodando sem proxy');
      return;
    }

    try {
      const encodedUser = encodeURIComponent(geonixUser);
      const encodedPass = encodeURIComponent(geonixPass);
      this.proxyUrl = `http://${encodedUser}:${encodedPass}@${geonixHost}:${geonixHttpPort}`;
      const socksUrl = `socks5://${encodedUser}:${encodedPass}@${geonixHost}:${geonixSocksPort}`;

      this.httpsAgent = new HttpsProxyAgent(this.proxyUrl);
      this.socksAgent = new SocksProxyAgent(socksUrl);

      this.enabled = true;

      const maskedUrl = this.proxyUrl.replace(/:[^:]*@/, ':****@');
      console.log(`[PROXY] ✅ Proxy ISP configurado: ${maskedUrl}`);
      console.log(`[PROXY] ✅ IP dedicado: ${geonixHost}`);
    } catch (error) {
      console.error('[PROXY] ❌ Erro ao configurar proxy:', error.message);
      this.enabled = false;
    }
  }

  static isEnabled(): boolean {
    return this.enabled;
  }

  static getHttpsAgent(): HttpsProxyAgent<string> | undefined {
    if (!this.enabled || !this.httpsAgent) {
      return undefined;
    }
    return this.httpsAgent;
  }

  static getSocksAgent(): SocksProxyAgent | undefined {
    if (!this.enabled || !this.socksAgent) {
      return undefined;
    }
    return this.socksAgent;
  }

  static getAxiosConfig(exchange: string): any {
    if (!this.enabled || !this.proxyExchanges.has(exchange.toLowerCase())) {
      return {};
    }

    return {
      httpsAgent: this.httpsAgent,
      httpAgent: this.httpsAgent,
      proxy: false,
    };
  }

  static usesProxy(exchange: string): boolean {
    return this.enabled && this.proxyExchanges.has(exchange.toLowerCase());
  }

  static getProxyUrl(): string {
    return this.proxyUrl;
  }
}

ProxyUtil.initialize();
