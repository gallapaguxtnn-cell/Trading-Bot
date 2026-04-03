import { Logger } from '@nestjs/common';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class ExchangeCacheUtil {
  private static instance: ExchangeCacheUtil;
  private readonly logger = new Logger(ExchangeCacheUtil.name);
  private cache: Map<string, CacheEntry<any>> = new Map();
  private readonly DEFAULT_TTL = 300000;

  private constructor() {}

  static getInstance(): ExchangeCacheUtil {
    if (!ExchangeCacheUtil.instance) {
      ExchangeCacheUtil.instance = new ExchangeCacheUtil();
    }
    return ExchangeCacheUtil.instance;
  }

  get<T>(key: string, ttl: number = this.DEFAULT_TTL): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  async getOrFetch<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number = this.DEFAULT_TTL
  ): Promise<T> {
    const cached = this.get<T>(key, ttl);
    if (cached) {
      return cached;
    }

    const data = await fetchFn();
    this.set(key, data);
    return data;
  }

  clear(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }

    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.cache.delete(key));
  }
}
