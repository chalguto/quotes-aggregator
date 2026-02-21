# AI Usage Documentation

This document describes every AI-assisted prompt used during the development of
the **Quotes Aggregator** technical assessment, the outputs obtained, and an
estimated time contribution. The assessment was completed using **GitHub Copilot
(Claude Sonnet 4.6)** inside Visual Studio Code.

---

## Session Overview

| Item | Detail |
|---|---|
| AI Tool | GitHub Copilot Chat (Claude Sonnet 4.6) |
| IDE | Visual Studio Code |
| Total prompts | 12 |



---

## Prompts & Outputs

### Prompt 1 — PDF Analysis

**Prompt:**
> Role: Act as a Software Architect and Senior Backend Developer with extensive experience.
>
> Context: I received a PDF containing the requirements for a Backend Developer technical test. The goal is to successfully pass this challenge by demonstrating technical strength and, above all, strict adherence to the instructions.
>
> Analysis Instruction (Task): Analyze the text of the attached PDF thoroughly and do the following step by step:
>
> 1. Requirements Identification: Extract a detailed list of all functional requirements (what the system must do) and non-functional requirements (technologies, architecture, performance).
>
> 2. Simplicity Filtering: Identify the simplest and most direct path to meet each point. Ignore any functionality that was not explicitly requested to avoid overengineering.
>
> 3. Data Proposal: Define what types of test data (mock data) would be ideal to validate that the backend logic works correctly.
>
> Constraints and Parameters:
>
> - Priority: Success is defined as fulfilling 100% of what is requested in the PDF.
>
> - Complexity: Keep the solution simple and minimal; do only what is asked.
>
> - Tone: Professional, analytical, and execution-focused.
>
> Output Format: Present your response structured as:
>
> - Objectives Summary: (What is expected to be achieved).
>
> - Compliance Checklist: (List of critical requirements identified).
>
> - Step-by-Step Action Plan: (How to approach the code logically).

**Purpose:** Extract and understand all 7 technical requirements from the assessment document.

**Output obtained:**
Structured extraction of all requirements:
1. API & Contract (OpenAPI 3.0)
2. Service Implementation (Node.js, resilience, observability)
3. CI/CD Pipeline (Azure DevOps)
4. Integration Platform Design (Azure Integration Services)
5. SQL Task
6. Quality & Performance (tests + k6)
7. Mandatory AI_USAGE.md

**Estimated time saved:** 15 min (manual PDF reading and structuring)

---

### Prompt 2 — Architecture Decision

**Prompt:**
> Use Node.js for the API. For requirement 4, use Azure Integration Services. Create the solution in a well-identified folder on the desktop.

**Purpose:** Establish technology choices and project structure before code generation.

**Output obtained:**
- Technology stack confirmed: Node.js + NestJS (TypeScript), opossum, prom-client
- Folder structure: `C:\Users\...\Desktop\quotes-aggregator\`
- Layer layout: `api/`, `service/src/`, `k8s/`, `cicd/`, `integration/azure/`, `sql/`, `performance/`

**Estimated time saved:** 20 min (project scaffolding decisions)

---

### Prompt 3 — OpenAPI Specification

**Prompt:**
> Generate a complete OpenAPI 3.0.3 specification for `POST /api/v1/quotes` including:
> idempotency key header, JWT Bearer security scheme, request/response schemas,
> error responses for 400/401/409/422/429/500/503, and a GET endpoint for retrieval by ID.

**Purpose:** Create the API contract (Requirement 1).

**Output obtained:**
- `api/openapi.yaml` — full OpenAPI 3.0.3 spec
- Schemas: `CreateQuoteRequest`, `QuoteResponse`, `ErrorResponse`, `HealthResponse`
- Idempotency-Key header as required parameter + X-Idempotency-Result response header

**Estimated time saved:** 45 min (writing full OpenAPI spec by hand)

---

### Prompt 4 — NestJS Service Implementation

**Prompt:**
> Create a NestJS TypeScript API service with:
> - NestJS modules, controllers, services, guards, interceptors, and exception filters
> - Prometheus metrics (prom-client) with isolated Registry and custom counters for quotes created and idempotency hits
> - Circuit breaker pattern using opossum in an OnModuleInit hook wrapping a mock external aggregator
> - AuthGuard implementing CanActivate with JWT Bearer authentication and DEV_API_TOKEN bypass for development
> - IdempotencyInterceptor using NestJS NestInterceptor interface with in-memory Map and 24h TTL
> - DTO validation with class-validator and class-transformer, including custom cross-field constraints for effectiveDate and expiryDate
> - Global HttpExceptionFilter normalising all errors with a consistent JSON shape

**Purpose:** Implement Requirement 2 — full service implementation in NestJS TypeScript.

**Output obtained:**
- `service/src/main.ts` — bootstrap entry point
- `service/src/app.module.ts` — root NestJS module
- `service/src/app.config.ts` — shared configurator (pipes, filters, interceptors)
- `service/src/config/configuration.ts` — `@nestjs/config` typed factory
- `service/src/common/filters/http-exception.filter.ts` — global error normaliser
- `service/src/common/guards/auth.guard.ts` — JWT Bearer guard
- `service/src/common/interceptors/idempotency.interceptor.ts` + `request-id.interceptor.ts`
- `service/src/common/services/idempotency.service.ts`
- `service/src/quotes/dto/create-quote.dto.ts` — class-validator DTO
- `service/src/quotes/quotes.service.ts` — business logic + circuit breaker
- `service/src/quotes/quotes.controller.ts` — POST + GET routes
- `service/src/quotes/quotes.module.ts`
- `service/src/health/`, `service/src/metrics/` — health and metrics modules
- `service/tsconfig.json`, `service/tsconfig.build.json`, `service/nest-cli.json`

**Estimated time saved:** 90 min

---

### Prompt 5 — Containerisation

**Prompt:**
> Create a multi-stage Dockerfile (node:20-alpine) with non-root user, HEALTHCHECK,
> and a docker-compose.yml with Redis and Prometheus services for local development.

**Purpose:** Requirement 2 containerisation aspect.

**Output obtained:**
- `service/Dockerfile` — three-stage build (builder compiles TypeScript / deps installs prod-only / production runs `node dist/main`)
- `docker-compose.yml` — three services: app, redis:7-alpine, prometheus
- `service/.dockerignore`

**Estimated time saved:** 30 min

---

### Prompt 6 — Kubernetes Manifests

**Prompt:**
> Create Kubernetes manifests for AKS deployment: Deployment with HPA (2–10 replicas),
> ClusterIP Service, ConfigMap, Namespace, ServiceAccount, readiness and liveness probes
> on /health, resource requests and limits, and Prometheus scrape annotations.

**Purpose:** Requirement 2 Kubernetes deployment on AKS.

**Output obtained:**
- `k8s/deployment.yaml` — Deployment with rolling update strategy
- `k8s/service.yaml` — ClusterIP Service
- `k8s/configmap.yaml` — environment ConfigMap
- `k8s/namespace-and-hpa.yaml` — Namespace, ServiceAccount, HPA

**Estimated time saved:** 40 min

---

### Prompt 7 — Azure DevOps Pipeline

**Prompt:**
> Create an Azure DevOps YAML pipeline with 5 stages:
> 1. Build (npm ci, ESLint, TypeScript compile via `nest build`)
> 2. Test (Vitest with JUnit + Cobertura output)
> 3. Container build (ACR push with BuildId tag)
> 4. Integration tests (container-as-service)
> 5. Deploy to AKS (only on main branch, with environment approval gate)

**Purpose:** Requirement 3 — CI/CD Pipeline.

**Output obtained:**
- `cicd/azure-pipelines.yml` — complete 5-stage pipeline

**Estimated time saved:** 50 min

---

### Prompt 8 — Azure Integration Services Design

**Prompt:**
> Design an Azure Integration Services interface for the QuoteIssued event:
> - JSON Schema for the event envelope (CloudEvents-style)
> - Azure Service Bus Premium namespace configuration with topics, subscriptions and SQL filters
> - A Node.js publisher module using @azure/service-bus SDK and DefaultAzureCredential
> - Architecture diagram and reliability design document (DLQ, idempotent consumer pattern)
> For subscription filters, use the `data.status` property so notification and policy services
> only receive APPROVED quotes.

**Purpose:** Requirement 4 — Integration Platform Design.

**Output obtained:**
- `integration/azure/quote-issued-schema.json` — JSON Schema v7
- `integration/azure/servicebus-config.json` — full namespace/topic/subscription config
- `integration/azure/INTEGRATION_DESIGN.md` — design document with Bicep snippet
- `service/src/events/publisher.service.ts` — NestJS Service Bus publisher service
- Updated `app.module.ts` and `quotes.service.ts` to wire up the publisher

**Estimated time saved:** 60 min

---

### Prompt 9 — SQL Task

**Prompt:**
> Write a T-SQL query for Microsoft SQL Server to retrieve the last (most recent) quote
> per documentId for a list of up to 500 document IDs. Use a ROW_NUMBER() window function
> with a table variable to pass the ID list. Include a three-index strategy: primary
> composite, covering (all projected columns in INCLUDE), and a filtered index for
> APPROVED quotes. Guard index creation with sys.indexes existence checks.

**Purpose:** Requirement 5 — SQL Task.

**Output obtained:**
- `sql/last_quote_per_document.sql` — ROW_NUMBER CTE solution with full T-SQL comments, table variable, and three conditional index DDL statements

**Estimated time saved:** 25 min

---

### Prompt 10 — Unit Tests

**Prompt:**
> Write comprehensive Vitest + Supertest tests for the Quotes Aggregator NestJS API covering:
> success path (all document types), idempotency (cached + missing key + invalid UUID),
> authentication (missing/malformed/invalid token), input validation (all mandatory fields),
> GET /quotes/:id (found + 404 + unauthenticated), response structure, and /metrics endpoint.
> Use @nestjs/testing Test.createTestingModule and override PublisherService with a vi.fn() mock
> so tests never hit Azure.

**Purpose:** Requirement 6 — Quality.

**Output obtained:**
- `service/test/quotes.spec.ts` — 8 describe blocks, 23 test cases, all passing

**Estimated time saved:** 45 min

---

### Prompt 11 — k6 Performance Script

**Prompt:**
> Create a k6 load test script for POST /api/v1/quotes with:
> - Four named stages (smoke, load, stress, soak) selectable via STAGE env var
> - Custom metrics: quotes_created counter, idempotency hits counter, create duration trend
> - Thresholds: p95 < 500ms, error rate < 1%, p95 create duration < 400ms
> - Scenario: 80% new quote creation, 20% duplicate submission for idempotency testing
> - 10% health check requests
> - handleSummary to write results/summary.json

**Purpose:** Requirement 6 — Performance Test.

**Output obtained:**
- `performance/k6-load-test.js` — production-quality k6 script

**Estimated time saved:** 35 min

---

### Prompt 12 — README and Documentation

**Prompt:**
> Generate a comprehensive README.md with:
> - Mermaid architecture diagram (C4 context level)
> - Mermaid sequence diagram for quote creation flow
> - Prerequisites and quick-start guide
> - Configuration reference table
> - Step-by-step instructions for running tests and k6 performance tests
> - CI/CD pipeline explanation
> - Azure deployment guide
> Explain everything clearly for a technical reviewer evaluating the assessment.

**Purpose:** Final deliverable documentation.

**Output obtained:**
- `README.md` — complete guide with 2 Mermaid diagrams

**Estimated time saved:** 40 min

---


| Requirement | Files Generated with AI | Time Saved |
|---|---|---|
| 1 — OpenAPI spec | 1 | 45 min |
| 2 — NestJS service | 16 | 90 min |
| 2 — Docker / K8s | 6 | 70 min |
| 3 — CI/CD | 1 | 50 min |
| 4 — Azure Integration | 4 | 60 min |
| 5 — SQL Task | 1 | 25 min |
| 6 — Tests + k6 | 2 | 80 min |
| NestJS + Vitest | 14 | 120 min |
| Cleanup & alignment | — | 40 min |
| Documentation | 1 | 40 min |
| **Total** | **46 files** | **~620 min** |

## Verification & Review

All AI-generated code was reviewed and manually validated:
- Architecture decisions were evaluated for fitness to the assessment requirements.
- Middleware chain order was inspected to ensure auth → idempotency → validation.
- Circuit breaker fallback behaviour was confirmed in the error handler.
- SQL queries were checked for correctness and index applicability.
- k6 thresholds were adjusted to realistic SLO values for a REST API.
- Azure Service Bus SQL filter syntax was verified against Service Bus documentation.

