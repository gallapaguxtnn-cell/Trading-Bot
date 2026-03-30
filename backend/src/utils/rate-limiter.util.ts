import { Logger } from '@nestjs/common';

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export class RateLimiterUtil {
  private static instance: RateLimiterUtil;
  private readonly logger = new Logger(RateLimiterUtil.name);
  private requestCounts: Map<string, number[]> = new Map();
  private cache: Map<string, CacheEntry<any>> = new Map();

  private readonly configs: Map<string, RateLimitConfig> = new Map([
    ['binance', { maxRequests: 50, windowMs: 60000 }],
    ['bybit', { maxRequests: 100, windowMs: 60000 }],
  ]);

  private constructor() {}

  static getInstance(): RateLimiterUtil {
    if (!RateLimiterUtil.instance) {
      RateLimiterUtil.instance = new RateLimiterUtil();
    }
    return RateLimiterUtil.instance;
  }

  async throttle(key: string, exchange: string = 'binance'): Promise<void> {
    const config = this.configs.get(exchange) || { maxRequests: 50, windowMs: 60000 };
    const now = Date.now();
    const requestKey = `${exchange}:${key}`;

    if (!this.requestCounts.has(requestKey)) {
      this.requestCounts.set(requestKey, []);
    }

    const timestamps = this.requestCounts.get(requestKey)!;
    const recentRequests = timestamps.filter(t => now - t < config.windowMs);

    if (recentRequests.length >= config.maxRequests) {
      const oldestRequest = recentRequests[0];
      const waitTime = config.windowMs - (now - oldestRequest);
      this.logger.warn(`[RATE LIMIT] ${exchange} - waiting ${waitTime}ms`);
      await this.sleep(waitTime);
    }

    recentRequests.push(now);
    this.requestCounts.set(requestKey, recentRequests);
  }

  getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  setCached<T>(key: string, data: T, ttlMs: number = 300000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs,
    });
  }

  clearCache(pattern?: string): void {
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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
