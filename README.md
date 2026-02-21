# Quotes Aggregator

A production-ready REST API that aggregates insurance quotes, built with **Node.js** + **NestJS**
for a technical assessment.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Project Structure](#project-structure)
3. [Requirements Coverage](#requirements-coverage)
4. [Prerequisites](#prerequisites)
5. [Quick Start (Local)](#quick-start-local)
6. [Running with Docker Compose](#running-with-docker-compose)
7. [API Reference](#api-reference)
8. [Configuration](#configuration)
9. [Running Tests](#running-tests)
10. [Performance Tests (k6)](#performance-tests-k6)
11. [CI/CD Pipeline](#cicd-pipeline)
12. [Kubernetes Deployment (AKS)](#kubernetes-deployment-aks)
13. [Azure Integration Services](#azure-integration-services)
14. [SQL Task](#sql-task)

---

## System Architecture

### C4 Context Diagram

```mermaid
C4Context
  title System Context — Quotes Aggregator

  Person(client, "API Client", "Mobile app / Portal / B2B partner")

  System_Boundary(quotes, "Quotes Aggregator") {
    System(api, "Quotes API", "Node.js / NestJS\nPOST /api/v1/quotes")
    System(publisher, "Event Publisher", "Azure Service Bus\n@azure/service-bus")
  }

  System_Ext(aggregator, "External Aggregator", "Third-party pricing engine\n(mocked)")
  System_Ext(sb, "Azure Service Bus", "quotes.issued topic\nPremium SKU")
  System_Ext(notify, "Notification Service", "Email / SMS on APPROVED")
  System_Ext(policy, "Policy Service", "Creates policy record")
  System_Ext(audit, "Audit Service", "Compliance logging")
  SystemDb_Ext(db, "SQL Server", "Persistent quotes store\n(production)")

  Rel(client, api, "HTTPS POST /api/v1/quotes", "Bearer JWT")
  Rel(api, aggregator, "Premium calculation", "HTTPS / Circuit Breaker")
  Rel(api, publisher, "Publish QuoteIssued", "async, non-blocking")
  Rel(publisher, sb, "sendMessages()", "@azure/service-bus SDK")
  Rel(sb, notify, "sub-notification-service", "SQL filter: APPROVED")
  Rel(sb, policy, "sub-policy-service", "SQL filter: APPROVED")
  Rel(sb, audit, "sub-audit-service", "ALL statuses")
  Rel(api, db, "Persist quote", "mssql / tedious")
```

### Quote Creation Sequence

```mermaid
sequenceDiagram
  autonumber
  participant C  as Client
  participant A  as Auth Middleware
  participant I  as Idempotency MW
  participant V  as Validation MW
  participant S  as QuotesService
  participant X  as External Aggregator
  participant P  as Event Publisher
  participant SB as Service Bus

  C  ->> A:  POST /api/v1/quotes<br/>Authorization: Bearer <token><br/>Idempotency-Key: <uuid>
  A  ->> A:  Validate JWT / dev token
  A  -->> C: 401 (if invalid)
  A  ->> I:  Forward authenticated request
  I  ->> I:  Check idempotency key in cache
  I  -->> C: 200 Cached (if duplicate key)
  I  ->> V:  Forward new request
  V  ->> V:  Validate body schema
  V  -->> C: 400 Validation errors (if invalid)
  V  ->> S:  createQuote(data)
  S  ->> X:  callExternalAggregator() [Circuit Breaker]
  alt Aggregator OK
    X  -->> S: { premium, status: APPROVED }
  else Aggregator fails / CB open
    S  -->> S: Fallback → { status: PENDING }
  end
  S  ->> S:  Persist quote in quotesDb
  S  -->> I: quote object
  I  ->> I:  Store in idempotency cache
  I  -->> C: 201 Created + Location header
  S  --)  P: publishQuoteIssued() [async]
  P  --)  SB: sendMessages(QuoteIssued)
```

---

## Project Structure

```
quotes-aggregator/
├── api/
│   └── openapi.yaml              # OpenAPI 3.0.3 specification (Req 1)
├── service/
│   ├── src/
│   │   ├── main.ts               # Bootstrap entry point
│   │   ├── app.module.ts         # Root NestJS module
│   │   ├── app.config.ts         # Shared app configurator (pipes, filters, interceptors)
│   │   ├── config/
│   │   │   └── configuration.ts  # @nestjs/config typed factory
│   │   ├── common/
│   │   │   ├── filters/
│   │   │   │   └── http-exception.filter.ts  # Global error normaliser
│   │   │   ├── guards/
│   │   │   │   └── auth.guard.ts             # JWT Bearer authentication
│   │   │   ├── interceptors/
│   │   │   │   ├── idempotency.interceptor.ts # Idempotency-Key enforcement
│   │   │   │   └── request-id.interceptor.ts  # X-Request-ID propagation
│   │   │   └── services/
│   │   │       └── idempotency.service.ts     # In-memory idempotency store
│   │   ├── quotes/
│   │   │   ├── dto/
│   │   │   │   └── create-quote.dto.ts   # class-validator DTO
│   │   │   ├── quotes.controller.ts      # POST + GET /api/v1/quotes
│   │   │   ├── quotes.module.ts
│   │   │   └── quotes.service.ts         # Business logic + circuit breaker
│   │   ├── health/
│   │   │   ├── health.controller.ts      # GET /health
│   │   │   └── health.module.ts
│   │   ├── metrics/
│   │   │   ├── metrics.controller.ts     # GET /metrics
│   │   │   ├── metrics.module.ts
│   │   │   └── metrics.service.ts        # Prometheus prom-client wrapper
│   │   └── events/
│   │       ├── events.module.ts
│   │       └── publisher.service.ts      # Azure Service Bus event publisher
│   ├── test/
│   │   └── quotes.spec.ts        # Vitest + Supertest test suite (Req 6)
│   ├── .env                      # Local dev environment (not committed)
│   ├── .env.example              # Environment variable template
│   ├── .dockerignore
│   ├── Dockerfile                # 3-stage Docker build (builder / deps / production)
│   ├── nest-cli.json
│   ├── tsconfig.json
│   ├── tsconfig.build.json
│   ├── vitest.config.ts
│   └── package.json
├── cicd/
│   └── azure-pipelines.yml       # Azure DevOps 5-stage pipeline (Req 3)
├── docker-compose.yml            # Local stack: app + Redis + Prometheus
├── integration/
│   └── azure/
│       ├── INTEGRATION_DESIGN.md # Architecture document (Req 4)
│       ├── quote-issued-schema.json  # QuoteIssued JSON Schema
│       └── servicebus-config.json   # Service Bus configuration
├── k8s/
│   ├── configmap.yaml            # ConfigMap (Req 2 / K8s)
│   ├── deployment.yaml           # AKS Deployment + HPA
│   ├── namespace-and-hpa.yaml    # Namespace + ServiceAccount + HPA
│   └── service.yaml              # ClusterIP Service
├── monitoring/
│   └── prometheus.yml            # Prometheus scrape config
├── performance/
│   └── k6-load-test.js           # k6 load test script (Req 6)
├── sql/
│   └── last_quote_per_document.sql  # Last quote per documentId (Req 5)
├── AI_USAGE.md                   # AI prompts documentation (Mandatory)
└── README.md                     # This file
```

---

## Requirements Coverage

| # | Requirement | Status | Key Files |
|---|---|---|---|
| 1 | OpenAPI 3.0 spec for POST /api/v1/quotes | ✅ | `api/openapi.yaml` |
| 2 | Node.js service with resilience, logging, metrics, K8s | ✅ | `service/src/`, `k8s/` |
| 3 | Azure DevOps CI/CD pipeline | ✅ | `cicd/azure-pipelines.yml` |
| 4 | Azure Integration Services — QuoteIssued event | ✅ | `integration/azure/` |
| 5 | SQL — last quote per documentId (500 IDs) | ✅ | `sql/last_quote_per_document.sql` |
| 6 | Unit tests (Vitest) + k6 performance script | ✅ | `service/test/`, `performance/` |
| — | AI_USAGE.md (mandatory) | ✅ | `AI_USAGE.md` |

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | ≥ 18 LTS | https://nodejs.org |
| npm | ≥ 9 | bundled with Node.js |
| Docker | ≥ 24 | https://docs.docker.com/get-docker/ |
| Docker Compose | v2 | bundled with Docker Desktop |
| k6 | latest | https://k6.io/docs/getting-started/installation/ |
| kubectl | ≥ 1.28 | https://kubernetes.io/docs/tasks/tools/ |
| Azure CLI | ≥ 2.55 | https://learn.microsoft.com/cli/azure/install-azure-cli |

---

## Quick Start (Local)

```bash
# 1. Clone / open project
cd C:\Users\<you>\Desktop\quotes-aggregator

# 2. Install dependencies
cd service
npm install

# 3. Copy environment file
# (already created — review service/.env)

# 4. Start the API
npm start

# The API is now running at http://localhost:3000
```

### Make your first request

```bash
# Create a quote
curl -X POST http://localhost:3000/api/v1/quotes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-token-quotes-2026" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "documentId": "DOC-123",
    "documentType": "AUTO",
    "insuredName": "Jane Doe",
    "insuredEmail": "jane@example.com",
    "coverageAmount": 50000,
    "currency": "USD",
    "effectiveDate": "2099-01-01",
    "expiryDate": "2100-12-31"
  }'
```

**Windows (PowerShell):**

```powershell
$key = [System.Guid]::NewGuid().ToString()
Invoke-RestMethod -Method POST `
  -Uri "http://localhost:3000/api/v1/quotes" `
  -Headers @{
    "Authorization"   = "Bearer dev-token-quotes-2026"
    "Idempotency-Key" = $key
    "Content-Type"    = "application/json"
  } `
  -Body '{"documentId":"DOC-PS1","documentType":"HOME","insuredName":"John","insuredEmail":"j@x.com","coverageAmount":100000,"currency":"USD","effectiveDate":"2099-01-01","expiryDate":"2100-12-31"}'
```

---

## Running with Docker Compose

```bash
# From project root
docker compose up --build

# Services started:
#   quotes-aggregator  → http://localhost:3000
#   Redis              → localhost:6379
#   Prometheus         → http://localhost:9090
```

### Endpoints

| Endpoint | Description |
|---|---|
| `POST /api/v1/quotes` | Create a new quote |
| `GET  /api/v1/quotes/:id` | Retrieve a quote by ID |
| `GET  /health` | Liveness/readiness check |
| `GET  /metrics` | Prometheus metrics (text/plain) |

---

## API Reference

The full specification is in [`api/openapi.yaml`](api/openapi.yaml). Key details:

### POST /api/v1/quotes

**Required headers:**

| Header | Description |
|---|---|
| `Authorization` | `Bearer <token>` — JWT or DEV_API_TOKEN |
| `Idempotency-Key` | UUID v4 — prevents duplicate submissions |
| `Content-Type` | `application/json` |

**Request body:**

```json
{
  "documentId":     "DOC-123",
  "documentType":   "AUTO",
  "insuredName":    "Jane Doe",
  "insuredEmail":   "jane@example.com",
  "coverageAmount": 50000.00,
  "currency":       "USD",
  "effectiveDate":  "2099-01-01",
  "expiryDate":     "2100-12-31"
}
```

**Supported `documentType` values:** `AUTO`, `HOME`, `LIFE`, `HEALTH`, `TRAVEL`

**Response 201:**

```json
{
  "quoteId":        "q-abc123def456",
  "documentId":     "DOC-123",
  "documentType":   "AUTO",
  "insuredName":    "Jane Doe",
  "insuredEmail":   "jane@example.com",
  "coverageAmount": 50000.00,
  "premium":        1250.00,
  "currency":       "USD",
  "status":         "APPROVED",
  "effectiveDate":  "2099-01-01",
  "expiryDate":     "2100-12-31",
  "createdAt":      "2026-02-20T10:00:00.000Z"
}
```

**Error codes:**

| HTTP | Code | Cause |
|---|---|---|
| 400 | `MISSING_IDEMPOTENCY_KEY` | Header absent |
| 400 | `INVALID_IDEMPOTENCY_KEY` | Not a valid UUID v4 |
| 400 | `VALIDATION_ERROR` | Invalid body fields |
| 401 | `MISSING_TOKEN` | No / malformed Authorization |
| 401 | `INVALID_TOKEN` | Token rejected |
| 409 | `IDEMPOTENCY_CONFLICT` | Different body, same key |
| 503 | `SERVICE_UNAVAILABLE` | Circuit breaker open |

---

## Configuration

All settings come from environment variables. Copy `service/.env.example` → `service/.env`.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `NODE_ENV` | `development` | `development`, `test`, `production` |
| `LOG_LEVEL` | `info` | Log level (`debug`, `info`, `warn`, `error`) |
| `DEV_API_TOKEN` | `dev-token-quotes-2026` | Dev bypass Bearer token (non-prod only) |
| `JWT_SECRET` | *(insecure default)* | JWT signing secret — **change in prod** |
| `JWT_ISSUER` | `quotes-aggregator` | Expected `iss` claim |
| `JWT_AUDIENCE` | `quotes-api` | Expected `aud` claim |
| `REDIS_URL` | *(in-memory fallback)* | Redis URL for idempotency store |
| `IDEMPOTENCY_TTL` | `86400` | Idempotency key TTL in seconds (24 h) |
| `CB_TIMEOUT` | `3000` | Circuit breaker call timeout (ms) |
| `CB_ERROR_THRESHOLD` | `50` | Error % to open circuit |
| `CB_RESET_TIMEOUT` | `30000` | Time before circuit retries (ms) |
| `CB_VOLUME_THRESHOLD` | `5` | Minimum calls before CB evaluates |
| `RATE_LIMIT_MAX` | `100` | Max requests per minute per IP |
| `SERVICE_BUS_CONNECTION_STRING` | *(unset)* | SB connection string (dev only) |
| `SERVICE_BUS_NAMESPACE` | *(unset)* | SB namespace (production — uses Managed Identity) |
| `SERVICE_BUS_TOPIC_NAME` | `quotes.issued` | Service Bus topic name |

---

## Running Tests

```bash
cd service

# Install dependencies (if not done already)
npm install

# Run all tests
npm test

# Run with coverage report
npm run test:coverage

# Watch mode (development)
npx vitest --watch
```

### Coverage thresholds (configured in `vitest.config.ts`)

| Category | Minimum |
|---|---|
| Statements | 70% |
| Branches | 45% |
| Functions | 60% |
| Lines | 70% |

### What is tested

- **Happy path** — POST returns 201 with all required fields for all 5 document types
- **Idempotency** — duplicate key returns 200 with `x-idempotency-result: cached`
- **Missing / invalid Idempotency-Key** — 400 errors
- **Authentication** — missing, malformed, invalid tokens → 401
- **Validation** — each mandatory field missing or invalid → 400 VALIDATION_ERROR
- **GET by ID** — found (200), not found (404), unauthenticated (401)
- **Response structure** — all required fields present + X-Request-ID header
- **Metrics endpoint** — Prometheus text format

> The Service Bus publisher is **mocked** in tests — no Azure connection required.

---

## Performance Tests (k6)

```bash
# Install k6
# Windows: choco install k6
# macOS:   brew install k6

# Make sure the API is running locally first
npm start   # inside service/

# Smoke test (1 VU / 1 min — validates script)
k6 run --env STAGE=smoke performance/k6-load-test.js

# Load test (ramp to 50 VUs, 12 min total) — DEFAULT
k6 run performance/k6-load-test.js

# Stress test (ramp to 200 VUs — find breaking point)
k6 run --env STAGE=stress performance/k6-load-test.js

# Soak test (30 VUs / 60 min — check for memory leaks)
k6 run --env STAGE=soak performance/k6-load-test.js

# Custom base URL (e.g., staging)
k6 run --env BASE_URL=https://quotes-api.staging.example.com \
        --env AUTH_TOKEN=<your-token> \
        performance/k6-load-test.js
```

### Success Thresholds

| Metric | Threshold |
|---|---|
| `http_req_duration p(95)` | < 500 ms |
| `http_req_duration p(99)` | < 1000 ms |
| `http_req_failed rate` | < 1% |
| `quote_create_duration p(95)` | < 400 ms |

Test results are written to `performance/results/summary.json`.

---

## CI/CD Pipeline

File: [`cicd/azure-pipelines.yml`](cicd/azure-pipelines.yml)

```mermaid
flowchart LR
  A([Build\nnpm ci + lint + tsc]) --> B([Test\nVitest + coverage])
  B --> C([Container\nDocker build + ACR push])
  C --> D([Integration\ncontainer-as-service tests])
  D --> E{main branch?}
  E -- yes --> F([Deploy\nkubectl apply → AKS])
  E -- no  --> G([Skip deploy])
```

### Pipeline stages

| Stage | Trigger | Actions |
|---|---|---|
| **Build** | Always | `npm ci`, ESLint, `nest build` (TypeScript compile), publish artifact |
| **Test** | After Build | `vitest run --coverage`, publish JUnit + Cobertura |
| **ContainerBuild** | After Test | Docker build, smoke test (`node --check dist/main.js`), push to ACR with `$(Build.BuildId)` tag |
| **IntegrationTest** | After Container | Spin up container-as-service, run vitest integration tests |
| **DeployProduction** | `main` branch only + approval gate | `az aks get-credentials`, `kubectl apply -f k8s/`, set image, wait for rollout |

### Azure DevOps Variable Groups required

| Variable Group | Variables |
|---|---|
| `quotes-aggregator-prod` | `ACR_NAME`, `AKS_CLUSTER_NAME`, `AKS_RESOURCE_GROUP` |

### Service Connection required

- `azure-subscription` — Azure Resource Manager connection with contributor access to ACR and AKS

---

## Kubernetes Deployment (AKS)

```bash
# Authenticate to AKS
az aks get-credentials \
  --resource-group rg-quotes-prod \
  --name aks-quotes-prod

# Deploy all manifests
kubectl apply -f k8s/

# Verify rollout
kubectl rollout status deployment/quotes-aggregator -n quotes

# View pods
kubectl get pods -n quotes

# View HPA status
kubectl get hpa -n quotes

# Port-forward for local testing
kubectl port-forward svc/quotes-aggregator 8080:80 -n quotes
```

### Kubernetes Resources

| Resource | Details |
|---|---|
| `Namespace` | `quotes` |
| `ServiceAccount` | `quotes-aggregator-sa` (for Workload Identity) |
| `Deployment` | 2 replicas, rolling update (maxSurge=1, maxUnavailable=0) |
| `HPA` | 2–10 replicas, CPU 70%, Memory 80% |
| `Service` | ClusterIP on port 80 → container port 3000 |
| `ConfigMap` | All non-secret configuration |

---

## Azure Integration Services

See [`integration/azure/INTEGRATION_DESIGN.md`](integration/azure/INTEGRATION_DESIGN.md) for the full architecture.

### QuoteIssued Event Flow

```mermaid
flowchart TD
  A[Quotes Aggregator\nAKS] -->|sendMessages| B[Service Bus Topic\nquotes.issued]
  B -->|SQL filter:\nstatus = APPROVED| C[sub-notification-service\nEmail/SMS]
  B -->|SQL filter:\nstatus = APPROVED| D[sub-policy-service\nCreate Policy]
  B -->|all statuses| E[sub-audit-service\nCompliance Log]
  B -->|maxDelivery exceeded| F[Dead-Letter Queue]
  F -->|ops review| G[Re-enqueue / Fix]
```

### Event schema

See [`integration/azure/quote-issued-schema.json`](integration/azure/quote-issued-schema.json).

### Service Bus configuration

See [`integration/azure/servicebus-config.json`](integration/azure/servicebus-config.json).

---

## SQL Task

File: [`sql/last_quote_per_document.sql`](sql/last_quote_per_document.sql)

**Goal:** Retrieve the most recent quote per `documentId` for up to 500 document IDs.
**RDBMS:** Microsoft SQL Server (T-SQL)

### Recommended approach — ROW_NUMBER window function

```sql
DECLARE @target_docs TABLE (document_id VARCHAR(50) NOT NULL PRIMARY KEY);
-- INSERT INTO @target_docs VALUES (@id1), (@id2), ...;

;WITH ranked_quotes AS (
    SELECT
        q.id, q.document_id, q.document_type, q.insured_name, q.insured_email,
        q.coverage_amt, q.premium, q.currency, q.status,
        q.effective_dt, q.expiry_dt, q.created_at,
        ROW_NUMBER() OVER (
            PARTITION BY q.document_id
            ORDER BY q.created_at DESC, q.id DESC
        ) AS rn
    FROM quotes AS q
    INNER JOIN @target_docs AS t ON q.document_id = t.document_id
)
SELECT id, document_id, document_type, insured_name, insured_email,
       coverage_amt, premium, currency, status, effective_dt, expiry_dt, created_at
FROM ranked_quotes
WHERE rn = 1
ORDER BY document_id;
```

### Index strategy

```sql
-- Primary composite index
CREATE INDEX IX_quotes_document_id_created_at
    ON dbo.quotes (document_id ASC, created_at DESC, id DESC);

-- Covering index (eliminates key lookups)
CREATE INDEX IX_quotes_document_id_created_at_covering
    ON dbo.quotes (document_id ASC, created_at DESC, id DESC)
    INCLUDE (document_type, insured_name, insured_email,
             coverage_amt, premium, currency, status, effective_dt, expiry_dt);

-- Filtered index for APPROVED-only queries
CREATE INDEX IX_quotes_document_id_created_at_approved
    ON dbo.quotes (document_id ASC, created_at DESC, id DESC)
    INCLUDE (document_type, insured_name, insured_email,
             coverage_amt, premium, currency, effective_dt, expiry_dt)
    WHERE status = 'APPROVED';
```

All index creation statements in the SQL file are guarded with
`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE ...)` to be safe for re-runs.

---

## Author

Technical assessment solution — Backend Developer position.

> See [AI_USAGE.md](AI_USAGE.md) for a full audit of AI tool usage during development.
