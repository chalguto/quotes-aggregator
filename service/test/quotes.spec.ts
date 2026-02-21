/**
 * Quotes API — integration tests with Vitest + Supertest.
 *
 * Uses @nestjs/testing to spin up the full NestJS application.
 * PublisherService is overridden with a mock so tests never hit Azure.
 *
 * Run:  npm test                (inside service/)
 *       npm run test:coverage   (with V8 coverage)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../src/app.module';
import { PublisherService } from '../src/events/publisher.service';
import { configureApp } from '../src/app.config';

// ─── Test constants ───────────────────────────────────────────────────────────
const AUTH_TOKEN = 'vitest-dev-token';

function authHeader(): string {
  return `Bearer ${AUTH_TOKEN}`;
}

/** Minimal valid POST /api/v1/quotes payload */
function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    documentId: 'DOC123',
    documentType: 'AUTO',
    insuredName: 'Jane Doe',
    insuredEmail: 'jane@example.com',
    coverageAmount: 50000,
    currency: 'USD',
    effectiveDate: '2099-01-01',
    expiryDate: '2100-01-01',
    ...overrides,
  };
}

// ─── Application setup ────────────────────────────────────────────────────────

let app: INestApplication;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DEV_API_TOKEN = AUTH_TOKEN;

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    // Replace the real publisher with a no-op mock — tests never hit Azure
    .overrideProvider(PublisherService)
    .useValue({ publishQuoteIssued: vi.fn().mockResolvedValue(undefined) })
    .compile();

  app = moduleFixture.createNestApplication();
  configureApp(app);
  await app.init();
});

afterAll(async () => {
  await app.close();
});

// =============================================================================
// 1. Health endpoint
// =============================================================================
describe('GET /health', () => {
  it('returns 200 with status healthy', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toMatch(/healthy|degraded/);
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('version');
  });
});

// =============================================================================
// 2. POST /api/v1/quotes — happy path
// =============================================================================
describe('POST /api/v1/quotes', () => {
  it('returns 201 with a valid quote object', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/quotes')
      .set('Authorization', authHeader())
      .set('Idempotency-Key', uuidv4())
      .send(validPayload());

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('quoteId');
    expect(res.body).toHaveProperty('status');
    expect(res.body.documentId).toBe('DOC123');
    expect(res.body.currency).toBe('USD');
    expect(res.body.premium).toBeGreaterThan(0);
    expect(res.headers).toHaveProperty('location');
    expect(res.headers['x-idempotency-result']).toBe('created');
  });

  it('returns 201 for all supported document types', async () => {
    const types = ['AUTO', 'HOME', 'LIFE', 'HEALTH', 'TRAVEL'];
    for (const documentType of types) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/quotes')
        .set('Authorization', authHeader())
        .set('Idempotency-Key', uuidv4())
        .send(validPayload({ documentType }));

      expect(res.status).toBe(201);
      expect(res.body.documentType).toBe(documentType);
    }
  });
});

// =============================================================================
// 3. POST /api/v1/quotes — idempotency
// =============================================================================
describe('POST /api/v1/quotes — idempotency', () => {
  it('returns 200 with cached result on repeated Idempotency-Key', async () => {
    const idempotencyKey = uuidv4();
    const payload = validPayload({ documentId: 'DUP001' });
    const server = app.getHttpServer();

    const first = await request(server)
      .post('/api/v1/quotes')
      .set('Authorization', authHeader())
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(first.status).toBe(201);

    const duplicate = await request(server)
      .post('/api/v1/quotes')
      .set('Authorization', authHeader())
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(duplicate.status).toBe(200);
    expect(duplicate.headers['x-idempotency-result']).toBe('cached');
    expect(duplicate.body.quoteId).toBe(first.body.quoteId);
  });

  it('returns 400 when Idempotency-Key header is missing', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/quotes')
      .set('Authorization', authHeader())
      .send(validPayload());

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('returns 400 when Idempotency-Key is not a valid UUID v4', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/quotes')
      .set('Authorization', authHeader())
      .set('Idempotency-Key', 'not-a-uuid')
      .send(validPayload());

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
  });
});

// =============================================================================
// 4. POST /api/v1/quotes — authentication
// =============================================================================
describe('POST /api/v1/quotes — authentication', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/quotes')
      .set('Idempotency-Key', uuidv4())
      .send(validPayload());

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TOKEN');
  });

  it('returns 401 when Authorization header is malformed', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/quotes')
      .set('Authorization', 'NotBearer token')
      .set('Idempotency-Key', uuidv4())
      .send(validPayload());

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TOKEN');
  });

  it('returns 401 with an invalid token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/quotes')
      .set('Authorization', 'Bearer totally.invalid.token')
      .set('Idempotency-Key', uuidv4())
      .send(validPayload());

    expect(res.status).toBe(401);
  });
});

// =============================================================================
// 5. POST /api/v1/quotes — input validation
// =============================================================================
describe('POST /api/v1/quotes — validation errors', () => {
  async function expectValidationError(
    overrides: Record<string, unknown>,
    fieldSubstring: string,
  ) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/quotes')
      .set('Authorization', authHeader())
      .set('Idempotency-Key', uuidv4())
      .send(validPayload(overrides));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    if (fieldSubstring) {
      const fields = (res.body.errors as any[])
        .map((e: any) => e.field ?? '')
        .join(',');
      expect(fields.toLowerCase()).toContain(fieldSubstring.toLowerCase());
    }
    return res;
  }

  it('rejects missing documentId', () =>
    expectValidationError({ documentId: undefined }, 'documentId'));

  it('rejects invalid documentType', () =>
    expectValidationError({ documentType: 'BOAT' }, 'documentType'));

  it('rejects missing insuredEmail', () =>
    expectValidationError({ insuredEmail: undefined }, 'insuredEmail'));

  it('rejects malformed insuredEmail', () =>
    expectValidationError({ insuredEmail: 'not-an-email' }, 'insuredEmail'));

  it('rejects non-positive coverageAmount', () =>
    expectValidationError({ coverageAmount: 0 }, 'coverageAmount'));

  it('rejects invalid currency code', () =>
    expectValidationError({ currency: 'US' }, 'currency'));

  it('rejects past effectiveDate', () =>
    expectValidationError({ effectiveDate: '2000-01-01' }, 'effectiveDate'));

  it('rejects expiryDate before effectiveDate', () =>
    expectValidationError(
      { effectiveDate: '2099-06-01', expiryDate: '2099-01-01' },
      'expiryDate',
    ));
});

// =============================================================================
// 6. GET /api/v1/quotes/:quoteId
// =============================================================================
describe('GET /api/v1/quotes/:quoteId', () => {
  let createdQuoteId: string;

  beforeAll(async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/quotes')
      .set('Authorization', authHeader())
      .set('Idempotency-Key', uuidv4())
      .send(validPayload({ documentId: 'GET-TEST-001' }));

    createdQuoteId = res.body.quoteId as string;
  });

  it('returns the quote by ID', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/quotes/${createdQuoteId}`)
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.quoteId).toBe(createdQuoteId);
  });

  it('returns 404 for unknown quoteId', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/quotes/q-nonexistent')
      .set('Authorization', authHeader());

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app.getHttpServer()).get(
      `/api/v1/quotes/${createdQuoteId}`,
    );
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// 7. Response structure
// =============================================================================
describe('Quote response structure', () => {
  it('contains all required fields', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/quotes')
      .set('Authorization', authHeader())
      .set('Idempotency-Key', uuidv4())
      .send(validPayload());

    expect(res.status).toBe(201);
    const required = [
      'quoteId', 'documentId', 'documentType', 'insuredName',
      'insuredEmail', 'coverageAmount', 'currency', 'premium',
      'status', 'effectiveDate', 'expiryDate', 'createdAt',
    ];
    for (const field of required) {
      expect(res.body).toHaveProperty(field);
    }
  });

  it('includes X-Request-ID response header', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/quotes')
      .set('Authorization', authHeader())
      .set('Idempotency-Key', uuidv4())
      .send(validPayload());

    expect(res.headers).toHaveProperty('x-request-id');
  });
});

// =============================================================================
// 8. Metrics endpoint
// =============================================================================
describe('GET /metrics', () => {
  it('returns Prometheus text format', async () => {
    const res = await request(app.getHttpServer()).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('# HELP');
  });
});
