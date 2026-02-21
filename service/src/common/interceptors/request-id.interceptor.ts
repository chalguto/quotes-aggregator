import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response } from 'express';

/**
 * Generates a unique request ID for every incoming request and attaches it
 * to both the request object (req.requestId) and the X-Request-ID response header.
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const requestId =
      (req.headers['x-request-id'] as string) || uuidv4();

    (req as any).requestId = requestId;
    res.setHeader('X-Request-ID', requestId);

    return next.handle().pipe(
      tap(() => {
        // Header is already set; tap used only for side-effect visibility
      }),
    );
  }
}
