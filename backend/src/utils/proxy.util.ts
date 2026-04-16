import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

export class ProxyUtil {
  private static httpsAgent: HttpsProxyAgent<string> | null = null;
  private static socksAgent: SocksProxyAgent | null = null;
  private static enabled: boolean = false;
  private static proxyUrl: string = '';

  static initialize() {
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
      this.proxyUrl = `http://${geonixUser}:${geonixPass}@${geonixHost}:${geonixHttpPort}`;
      const socksUrl = `socks5://${geonixUser}:${geonixPass}@${geonixHost}:${geonixSocksPort}`;

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

  static getAxiosConfig(): any {
    if (!this.enabled) {
      return {};
    }

    return {
      httpsAgent: this.httpsAgent,
      httpAgent: this.httpsAgent,
      proxy: false,
    };
  }

  static getProxyUrl(): string {
    return this.proxyUrl;
  }
}

ProxyUtil.initialize();
