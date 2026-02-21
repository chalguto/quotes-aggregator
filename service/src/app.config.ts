import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';

/**
 * Applies all global pipes, filters, and interceptors to the application.
 * Called from both main.ts (production) and the test setup, so both
 * environments share identical middleware behaviour.
 */
export function configureApp(app: INestApplication): void {
  // ─── Validation ────────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      stopAtFirstError: false,
      exceptionFactory: (errors: ValidationError[]) =>
        new BadRequestException({
          status: 400,
          code: 'VALIDATION_ERROR',
          error: 'Validation Error',
          message: 'Request body validation failed',
          errors: errors.map((e) => ({
            field: e.property,
            message: Object.values(e.constraints ?? {}).join(', '),
          })),
        }),
    }),
  );

  // ─── Exception Filter ──────────────────────────────────────────────────────
  app.useGlobalFilters(new HttpExceptionFilter());

  // ─── Request ID ────────────────────────────────────────────────────────────
  app.useGlobalInterceptors(new RequestIdInterceptor());

  // ─── Graceful Shutdown ─────────────────────────────────────────────────────
  app.enableShutdownHooks();
}
