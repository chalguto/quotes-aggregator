import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * Wraps prom-client metrics in a NestJS singleton service.
 * Uses a dedicated Registry instance to avoid conflicts between test runs.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly register: Registry;

  readonly httpRequestDuration: Histogram<string>;
  readonly quotesCreatedTotal: Counter<string>;
  readonly idempotencyHitsTotal: Counter<string>;
  readonly circuitBreakerState: Gauge<string>;

  constructor() {
    this.register = new Registry();
    this.register.setDefaultLabels({ app: 'quotes-aggregator' });

    collectDefaultMetrics({ register: this.register });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.register],
    });

    this.quotesCreatedTotal = new Counter({
      name: 'quotes_created_total',
      help: 'Total number of quotes created',
      labelNames: ['status', 'document_type'],
      registers: [this.register],
    });

    this.idempotencyHitsTotal = new Counter({
      name: 'idempotency_hits_total',
      help: 'Total number of idempotent requests served from cache',
      registers: [this.register],
    });

    this.circuitBreakerState = new Gauge({
      name: 'circuit_breaker_state',
      help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
      labelNames: ['service'],
      registers: [this.register],
    });
  }

  onModuleInit(): void {
    // Metrics are registered in the constructor; no additional init needed.
  }

  async getMetrics(): Promise<string> {
    return this.register.metrics();
  }

  get contentType(): string {
    return this.register.contentType;
  }
}
