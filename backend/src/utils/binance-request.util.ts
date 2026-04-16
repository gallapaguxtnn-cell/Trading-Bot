import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { ProxyUtil } from './proxy.util';

export class BinanceRequestUtil {
  static async request<T = any>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    const proxyConfig = ProxyUtil.getAxiosConfig();

    const finalConfig: AxiosRequestConfig = {
      ...config,
      ...proxyConfig,
      headers: {
        ...config.headers,
      },
    };

    try {
      const response = await axios.request<T>(finalConfig);
      return response;
    } catch (error) {
      if (error.response?.status === 418) {
        console.error('[BINANCE-REQUEST] ❌ IP BANNED (418) - Mesmo usando proxy!');
        console.error('[BINANCE-REQUEST] Proxy ativo:', ProxyUtil.isEnabled());
      }
      throw error;
    }
  }

  static async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, method: 'GET', url });
  }

  static async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, method: 'POST', url, data });
  }

  static async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, method: 'PUT', url, data });
  }

  static async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, method: 'DELETE', url });
  }
}
