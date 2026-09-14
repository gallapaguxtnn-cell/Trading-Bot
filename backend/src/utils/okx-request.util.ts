import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { ProxyUtil } from './proxy.util';

export class OkxRequestUtil {
  static async request<T = any>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    const proxyConfig = ProxyUtil.getAxiosConfig();

    const finalConfig: AxiosRequestConfig = {
      ...config,
      ...proxyConfig,
      headers: {
        ...config.headers,
      },
    };

    return axios.request<T>(finalConfig);
  }

  static async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, method: 'GET', url });
  }

  static async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, method: 'POST', url, data });
  }
}
