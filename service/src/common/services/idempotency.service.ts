import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface CachedEntry {
  body: any;
  createdAt: number;
}

/**
 * In-memory idempotency store scoped to the application lifetime.
 * For production, swap the Map for a Redis-backed implementation:
 *   await redis.setEx(`idempotency:${key}`, ttlSeconds, JSON.stringify(body))
 */
@Injectable()
export class IdempotencyService {
  private readonly store = new Map<string, CachedEntry>();
  private readonly ttlMs: number;

  constructor(private readonly configService: ConfigService) {
    const ttlSeconds = this.configService.get<number>('idempotency.ttlSeconds') ?? 86400;
    this.ttlMs = ttlSeconds * 1000;
  }

  get(key: string): CachedEntry | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() - entry.createdAt < this.ttlMs) {
      return entry;
    }

    // Expired — evict
    this.store.delete(key);
    return null;
  }

  set(key: string, body: any): void {
    this.store.set(key, { body, createdAt: Date.now() });
  }

  /** Exposed for testing purposes */
  clear(): void {
    this.store.clear();
  }
}
