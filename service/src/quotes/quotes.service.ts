import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import CircuitBreaker from 'opossum';
import { v4 as uuidv4 } from 'uuid';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { MetricsService } from '../metrics/metrics.service';
import { PublisherService } from '../events/publisher.service';

export interface Quote {
  quoteId: string;
  documentId: string;
  documentType: string;
  insuredName: string;
  insuredEmail: string;
  coverageAmount: number;
  currency: string;
  effectiveDate: string;
  expiryDate: string;
  premium: number;
  status: 'APPROVED' | 'PENDING';
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const RATES: Record<string, number> = {
  AUTO: 0.025,
  HOME: 0.018,
  LIFE: 0.012,
  HEALTH: 0.020,
  TRAVEL: 0.008,
};

/** In-memory store — replace with a real DB in production */
const quotesDb = new Map<string, Quote>();

/**
 * Simulates a call to an external quotes aggregation engine.
 * 5 % random failure probability is intentional for circuit-breaker demos.
 */
async function callExternalAggregator(
  quoteData: CreateQuoteDto,
): Promise<{ premium: number; status: 'APPROVED' }> {
  await new Promise((r) => setTimeout(r, Math.random() * 100 + 20));

  if (Math.random() < 0.05) {
    throw new Error('External aggregator timeout');
  }

  const rate = RATES[quoteData.documentType] ?? 0.02;
  const premium = Math.round(quoteData.coverageAmount * rate * 100) / 100;
  return { premium, status: 'APPROVED' };
}

@Injectable()
export class QuotesService implements OnModuleInit {
  private readonly logger = new Logger(QuotesService.name);
  private breaker: CircuitBreaker;

  constructor(
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly publisherService: PublisherService,
  ) {}

  onModuleInit(): void {
    const cbOpts = {
      timeout: this.configService.get<number>('circuitBreaker.timeout') ?? 3000,
      errorThresholdPercentage:
        this.configService.get<number>('circuitBreaker.errorThresholdPercentage') ?? 50,
      resetTimeout:
        this.configService.get<number>('circuitBreaker.resetTimeout') ?? 30_000,
      volumeThreshold:
        this.configService.get<number>('circuitBreaker.volumeThreshold') ?? 5,
    };

    this.breaker = new CircuitBreaker(callExternalAggregator, cbOpts);

    this.breaker.on('open', () => {
      this.logger.warn('Circuit breaker OPEN');
      this.metricsService.circuitBreakerState.set({ service: 'external-aggregator' }, 1);
    });
    this.breaker.on('halfOpen', () => {
      this.logger.log('Circuit breaker HALF-OPEN');
      this.metricsService.circuitBreakerState.set({ service: 'external-aggregator' }, 2);
    });
    this.breaker.on('close', () => {
      this.logger.log('Circuit breaker CLOSED');
      this.metricsService.circuitBreakerState.set({ service: 'external-aggregator' }, 0);
    });

    this.breaker.fallback((quoteData: CreateQuoteDto) => {
      this.logger.warn('Circuit breaker fallback', { documentId: quoteData.documentId });
      const rate = RATES[quoteData.documentType] ?? 0.02;
      return {
        premium: Math.round(quoteData.coverageAmount * rate * 100) / 100,
        status: 'PENDING' as const,
      };
    });
  }

  async createQuote(dto: CreateQuoteDto & { idempotencyKey?: string }): Promise<Quote> {
    this.logger.log(`Creating quote for documentId=${dto.documentId}`);

    const aggregatorResult = await this.breaker.fire(dto);

    const quote: Quote = {
      quoteId: `q-${uuidv4().replace(/-/g, '').substring(0, 16)}`,
      documentId: dto.documentId,
      documentType: dto.documentType,
      insuredName: dto.insuredName,
      insuredEmail: dto.insuredEmail,
      coverageAmount: dto.coverageAmount,
      currency: dto.currency,
      effectiveDate: dto.effectiveDate,
      expiryDate: dto.expiryDate,
      premium: aggregatorResult.premium,
      status: aggregatorResult.status,
      metadata: dto.metadata ?? {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    quotesDb.set(quote.quoteId, quote);

    // Publish event non-blocking — errors are swallowed inside publisherService
    this.publisherService
      .publishQuoteIssued(quote, dto.idempotencyKey)
      .catch(() => undefined);

    this.metricsService.quotesCreatedTotal.inc({
      status: quote.status,
      document_type: quote.documentType,
    });

    this.logger.log(
      `Quote created quoteId=${quote.quoteId} status=${quote.status} premium=${quote.premium}`,
    );

    return quote;
  }

  getQuoteById(quoteId: string): Quote {
    const quote = quotesDb.get(quoteId);
    if (!quote) {
      throw new NotFoundException({
        status: 404,
        code: 'NOT_FOUND',
        error: 'Not Found',
        message: `Quote with id "${quoteId}" not found`,
      });
    }
    return quote;
  }
}
