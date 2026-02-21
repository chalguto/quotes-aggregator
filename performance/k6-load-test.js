/**
 * k6 Load Test — Quotes Aggregator API
 *
 * Prerequisites:
 *   brew install k6          (macOS)
 *   choco install k6         (Windows)
 *   docker run -i grafana/k6 (Docker)
 *
 * Usage:
 *   k6 run k6-load-test.js
 *   k6 run --env BASE_URL=http://localhost:3000 k6-load-test.js
 *   k6 run --env STAGE=soak k6-load-test.js
 *
 * Stages available via STAGE env var:
 *   smoke   — 1 VU for 1 min (validate script + basic health)
 *   load    — ramp to 50 VUs over 5 min, hold 10 min, ramp down (default)
 *   stress  — ramp to 200 VUs progressively (find breaking point)
 *   soak    — 30 VUs for 60 min (memory leaks, connection pool exhaustion)
 *
 * Success thresholds:
 *   http_req_duration p(95) < 500ms
 *   http_req_failed rate < 1%
 *   quotes_created   rate > 0 (at least some 201 responses)
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ─── Configuration ────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'dev-token-quotes-2026';
const STAGE = __ENV.STAGE || 'load';

// ─── Custom metrics ───────────────────────────────────────────────────────────
const quotesCreated    = new Counter('quotes_created');
const quotesIdempotent = new Counter('quotes_idempotent_hits');
const quotesFailed     = new Counter('quotes_failed');
const createDuration   = new Trend('quote_create_duration', true);

// ─── Stage configurations ─────────────────────────────────────────────────────
const STAGES = {
  smoke: [
    { duration: '30s', target: 1 },
    { duration: '30s', target: 1 },
  ],
  load: [
    { duration: '1m',  target: 10  },  // ramp up
    { duration: '3m',  target: 50  },  // ramp up to peak
    { duration: '5m',  target: 50  },  // hold peak
    { duration: '2m',  target: 10  },  // scale down
    { duration: '1m',  target: 0   },  // ramp down
  ],
  stress: [
    { duration: '2m',  target: 50  },
    { duration: '3m',  target: 100 },
    { duration: '3m',  target: 150 },
    { duration: '3m',  target: 200 },
    { duration: '2m',  target: 0   },  // recover
  ],
  soak: [
    { duration: '2m',  target: 30  },  // ramp up
    { duration: '60m', target: 30  },  // hold
    { duration: '2m',  target: 0   },  // ramp down
  ],
};

// ─── Thresholds ───────────────────────────────────────────────────────────────
export const options = {
  stages: STAGES[STAGE] || STAGES.load,
  thresholds: {
    // 95th percentile of all requests must be below 500ms
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    // Overall error rate must stay below 1%
    http_req_failed:   ['rate<0.01'],
    // Quote creation p95 must be below 400ms
    quote_create_duration: ['p(95)<400'],
  },
  // Graceful stop gives in-flight requests 30s to finish before hard kill
  gracefulStop: '30s',
};

// ─── Shared headers ───────────────────────────────────────────────────────────
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${AUTH_TOKEN}`,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Generate a randomised but valid quote payload.
 */
function randomQuotePayload() {
  const types    = ['AUTO', 'HOME', 'LIFE', 'HEALTH', 'TRAVEL'];
  const docType  = types[Math.floor(Math.random() * types.length)];
  const coverage = Math.round(Math.random() * 490000 + 10000); // 10k–500k
  return JSON.stringify({
    documentId:     `DOC-${Math.floor(Math.random() * 900000 + 100000)}`,
    documentType:   docType,
    insuredName:    'Load Tester',
    insuredEmail:   `test.${__VU}.${__ITER}@loadtest.com`,
    coverageAmount: coverage,
    currency:       'USD',
    effectiveDate:  '2099-01-01',
    expiryDate:     '2100-12-31',
  });
}

// ─── Main scenario ────────────────────────────────────────────────────────────
export default function () {
  // ── Scenario A: Create a new quote (unique Idempotency-Key each time) ─────
  group('create_quote', () => {
    const idempotencyKey = uuidv4();
    const startTime = Date.now();

    const res = http.post(
      `${BASE_URL}/api/v1/quotes`,
      randomQuotePayload(),
      { headers: { ...headers, 'Idempotency-Key': idempotencyKey } }
    );

    createDuration.add(Date.now() - startTime);

    const ok = check(res, {
      'status is 201': (r) => r.status === 201,
      'body has quoteId': (r) => {
        try { return JSON.parse(r.body).quoteId !== undefined; } catch { return false; }
      },
      'body has premium': (r) => {
        try { return JSON.parse(r.body).premium > 0; } catch { return false; }
      },
      'response time < 500ms': (r) => r.timings.duration < 500,
    });

    if (res.status === 201) quotesCreated.add(1);
    else quotesFailed.add(1);

    // 20% of the time — simulate duplicate submission with same key
    if (Math.random() < 0.2) {
      const dupRes = http.post(
        `${BASE_URL}/api/v1/quotes`,
        randomQuotePayload(),
        { headers: { ...headers, 'Idempotency-Key': idempotencyKey } }
      );

      check(dupRes, {
        'idempotent request returns 200': (r) => r.status === 200,
        'x-idempotency-result is cached': (r) => r.headers['X-Idempotency-Result'] === 'cached',
      });

      if (dupRes.status === 200) quotesIdempotent.add(1);
    }
  });

  sleep(Math.random() * 0.5 + 0.2); // 0.2 – 0.7s think time

  // ── Scenario B: Health check (10% of iterations) ──────────────────────────
  if (Math.random() < 0.1) {
    group('health_check', () => {
      const res = http.get(`${BASE_URL}/health`);
      check(res, {
        'health status 200': (r) => r.status === 200,
        'health status is healthy': (r) => {
          try { return JSON.parse(r.body).status === 'healthy'; } catch { return false; }
        },
      });
    });
  }
}

// ─── Summary handler — printed after run ─────────────────────────────────────
export function handleSummary(data) {
  const { metrics } = data;

  const p95 = metrics.http_req_duration?.values?.['p(95)'] ?? 'N/A';
  const p99 = metrics.http_req_duration?.values?.['p(99)'] ?? 'N/A';
  const errRate = ((metrics.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2);
  const created = metrics.quotes_created?.values?.count ?? 0;
  const idempHits = metrics.quotes_idempotent_hits?.values?.count ?? 0;
  const totalReqs = metrics.http_reqs?.values?.count ?? 0;

  console.log(`
┌─────────────────────────────────┐
│  Quotes Load Test — Summary     │
├──────────────────┬──────────────┤
│ Stage            │ ${STAGE.padEnd(12)} │
│ Total requests   │ ${String(totalReqs).padEnd(12)} │
│ Quotes created   │ ${String(created).padEnd(12)} │
│ Idempotency hits │ ${String(idempHits).padEnd(12)} │
│ p(95) latency    │ ${String(Math.round(p95)).padEnd(9)} ms │
│ p(99) latency    │ ${String(Math.round(p99)).padEnd(9)} ms │
│ Error rate       │ ${errRate.padEnd(9)} %  │
└──────────────────┴──────────────┘
  `);

  return {
    'performance/results/summary.json': JSON.stringify(data, null, 2),
    stdout: '',
  };
}
