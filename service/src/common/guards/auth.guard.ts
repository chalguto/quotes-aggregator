import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Auth guard — validates Bearer JWT tokens.
 *
 * In non-production environments it also accepts a fixed DEV_API_TOKEN
 * configured via the DEV_API_TOKEN environment variable, allowing test
 * clients to authenticate without a real JWT.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        status: 401,
        code: 'MISSING_TOKEN',
        error: 'Unauthorized',
        message:
          'Missing or invalid Bearer token. Include "Authorization: Bearer <token>" header.',
      });
    }

    const token = authHeader.split(' ')[1];
    const env = this.configService.get<string>('server.env');
    const devToken = this.configService.get<string>('auth.devApiToken');

    // Development / test bypass
    if (env !== 'production' && devToken && token === devToken) {
      (request as any).user = { sub: 'dev-user', scope: 'quotes:write quotes:read' };
      return true;
    }

    // Structural JWT validation — 3 Base64URL parts separated by dots
    const jwtPattern = /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/;
    if (!jwtPattern.test(token)) {
      throw new UnauthorizedException({
        status: 401,
        code: 'INVALID_TOKEN',
        error: 'Unauthorized',
        message: 'Invalid token format.',
      });
    }

    try {
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
      );
      if (!payload.sub) throw new Error('Missing sub claim');
      (request as any).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException({
        status: 401,
        code: 'INVALID_TOKEN',
        error: 'Unauthorized',
        message: 'Token validation failed.',
      });
    }
  }
}
