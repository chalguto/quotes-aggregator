import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, EMPTY } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { IdempotencyService } from '../services/idempotency.service';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Idempotency interceptor for POST endpoints.
 *
 * Behaviour:
 *  - Rejects requests that are missing the Idempotency-Key header (400).
 *  - Rejects keys that are not valid UUID v4 (400).
 *  - Returns the cached response with HTTP 200 + X-Idempotency-Result: cached
 *    if the key has been seen before (within TTL).
 *  - On a new key, lets the handler run, then stores the response body and
 *    adds X-Idempotency-Result: created to the response.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly idempotencyService: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const key = req.headers['idempotency-key'] as string | undefined;

    if (!key) {
      throw new BadRequestException({
        status: 400,
        code: 'MISSING_IDEMPOTENCY_KEY',
        error: 'Bad Request',
        message: 'Idempotency-Key header is required.',
      });
    }

    if (!UUID_V4.test(key)) {
      throw new BadRequestException({
        status: 400,
        code: 'INVALID_IDEMPOTENCY_KEY',
        error: 'Bad Request',
        message: 'Idempotency-Key must be a valid UUID v4.',
      });
    }

    const cached = this.idempotencyService.get(key);
    if (cached) {
      this.logger.log(`Cache hit for idempotency key ${key}`);
      res.setHeader('X-Idempotency-Result', 'cached');
      // Send cached response immediately and short-circuit the handler
      res.status(200).json(cached.body);
      return EMPTY;
    }

    // Store ID on request so the controller can reference it if needed
    (req as any).idempotencyKey = key;

    return next.handle().pipe(
      tap((data) => {
        this.idempotencyService.set(key, data);
        res.setHeader('X-Idempotency-Result', 'created');
      }),
    );
  }
}
