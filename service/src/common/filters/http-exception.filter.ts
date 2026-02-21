import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Catches ALL exceptions and normalises them into a consistent JSON error shape:
 * { status, code, error, message, requestId, timestamp }
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId: string = (request as any).requestId ?? '';

    // Headers already sent (e.g. idempotency cache hit) — nothing to do
    if (response.headersSent) return;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // If the exception already carries our structured format, pass it through
      if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'code' in exceptionResponse
      ) {
        response.status(status).json({
          ...(exceptionResponse as object),
          requestId,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // class-validator ValidationPipe errors come as { message: string[], error: string }
      const raw = exceptionResponse as any;
      const message = Array.isArray(raw?.message)
        ? raw.message[0]
        : (raw?.message ?? exception.message);

      response.status(status).json({
        status,
        code: this.codeFromStatus(status),
        error: raw?.error ?? HttpStatus[status],
        message,
        errors: Array.isArray(raw?.message)
          ? raw.message.map((m: string) => ({ message: m }))
          : undefined,
        requestId,
        timestamp: new Date().toISOString(),
      });
    } else {
      this.logger.error('Unhandled exception', exception as Error);
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_SERVER_ERROR',
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
        requestId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private codeFromStatus(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR',
      503: 'SERVICE_UNAVAILABLE',
    };
    return map[status] ?? 'UNKNOWN_ERROR';
  }
}
