# Integration Platform Design — Azure Integration Services

## Overview

When a quote is successfully created, the **Quotes Aggregator** service emits a
**`QuoteIssued`** domain event to an Azure Service Bus topic. Downstream systems
(Notification, Policy, Audit) each hold their own durable subscription and consume
the event independently.

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  Client                                                              │
│  POST /api/v1/quotes  ──►  Quotes Aggregator (AKS)                  │
│                               │                                      │
│                               │ 201 Created → returns QuoteResponse  │
│                               │                                      │
│                               │ async (best-effort, non-blocking)    │
│                               ▼                                      │
│                    ┌──────────────────────┐                          │
│                    │  Azure Service Bus   │                          │
│                    │  Namespace (Premium) │                          │
│                    │                      │                          │
│                    │  Topic: quotes.issued│                          │
│                    └──────┬───────────────┘                          │
│                           │                                          │
│          ┌────────────────┼──────────────────┐                       │
│          ▼                ▼                  ▼                       │
│  sub-notification  sub-policy-service  sub-audit-service             │
│  (APPROVED only)   (APPROVED only)     (ALL statuses)                │
│          │                │                  │                       │
│          ▼                ▼                  ▼                       │
│  Notification Svc   Policy Svc          Audit Svc                    │
│  (Email/SMS)        (Create Policy)     (Compliance Log)             │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Event Contract

### QuoteIssued v1.0

| Field | Type | Required | Description |
|---|---|---|---|
| `eventId` | UUID | ✓ | Unique event identifier (used for Service Bus duplicate detection) |
| `eventType` | string const | ✓ | `"com.example.quotes.QuoteIssued"` |
| `eventVersion` | string | ✓ | Schema version, currently `"1.0"` |
| `correlationId` | string | ✓ | HTTP `X-Request-ID` for end-to-end tracing |
| `idempotencyKey` | UUID | — | HTTP `Idempotency-Key` from originating request |
| `timestamp` | ISO 8601 | ✓ | Event production time |
| `source` | string | ✓ | `"quotes-aggregator"` |
| `data.quoteId` | string | ✓ | Quote identifier |
| `data.documentId` | string | ✓ | Policy document identifier |
| `data.documentType` | enum | ✓ | `AUTO`, `HOME`, `LIFE`, `HEALTH`, `TRAVEL` |
| `data.status` | enum | ✓ | `APPROVED`, `PENDING`, `REJECTED` |
| `data.premium` | number | ✓ | Calculated insurance premium |

Full schema: [`quote-issued-schema.json`](./quote-issued-schema.json)

---

## Service Bus Configuration

### Namespace

| Property | Value | Rationale |
|---|---|---|
| SKU | **Premium** | Required for VNet integration, private endpoints, and 1 MB message support |
| Zone Redundant | Yes | High availability across availability zones |
| Minimum TLS | 1.2 | Security baseline |
| Capacity | 1 Messaging Unit | Scales independently (not serverless) |

### Topic: `quotes.issued`

| Property | Value | Rationale |
|---|---|---|
| Message TTL | 7 days | Allow consumers time to recover from outages |
| Duplicate Detection | 30 min window | Prevents re-publishing same `eventId` |
| Ordering | Enabled | Guarantees FIFO within a session |
| Partitioning | Disabled | Required for ordering support in Premium |

### Subscriptions

| Subscription | Filter | Max Retry | Lock Duration | Description |
|---|---|---|---|---|
| `sub-notification-service` | `data.status = 'APPROVED'` | 10 | 5 min | Email/SMS notifications |
| `sub-policy-service` | `data.status = 'APPROVED'` | 5 | 10 min | Create policy record |
| `sub-audit-service` | (none — all) | 20 | 2 min | Compliance audit trail |

---

## Reliability Design

### Dead-Letter Queue (DLQ)

Every subscription automatically has a Dead-Letter Queue when:
- `maxDeliveryCount` is exceeded
- Message TTL expires (on `sub-notification-service` and `sub-policy-service`)
- SQL filter evaluation throws an exception (notification + policy)

Operations team monitors `quotes.issued/$DeadLetterQueue` and the
`sub-ops-team` subscription on `quotes.dlq-reprocessing` topic.

```
Failed delivery (maxDeliveryCount exceeded)
        │
        ▼
  <subscription>/$DeadLetterQueue
        │
        │  Ops team reviews / fixes consumer
        │
        ▼
  Re-enqueue to quotes.issued (manual or automation)
```

### Idempotent Consumer Pattern

Each downstream service **must** implement idempotent processing:
- Use `eventId` as the idempotency key in their own database
- Before processing: check if `eventId` was already handled
- After processing: persist `eventId` with final state

Service Bus duplicate detection (30 min window) prevents duplicates
**at publish time**, but consumers must still handle at-least-once delivery
for messages already in the subscription.

### Publisher Reliability

The publisher in `service/src/events/publisher.js` is intentionally:
- **Non-blocking** — `publishQuoteIssued` is fire-and-forget, errors are logged
  but never propagate to the HTTP response (202 Created is already sent)
- **Outbox pattern (future)** — for strict at-least-once delivery, store the event
  in DB alongside the quote in the same transaction, then publish asynchronously

---

## Authentication & Security

| Component | Authentication | Scope |
|---|---|---|
| Quotes Aggregator → Service Bus | Managed Identity (Workload Identity for AKS) | `Send` on `quotes.issued` |
| Notification Service | Managed Identity | `Listen` on `sub-notification-service` |
| Policy Service | Managed Identity | `Listen` on `sub-policy-service` |
| Audit Service | Managed Identity | `Listen` on `sub-audit-service` |
| Operations Team | Managed Identity (RBAC) | `Manage` on namespace |

**No SAS tokens** are used in production. Connection strings are only used
in local development (`.env.example` → `SERVICE_BUS_CONNECTION_STRING`).

---

## Azure Bicep Snippet — Service Bus

```bicep
param location string = resourceGroup().location
param namespaceName string = 'sb-quotes-aggregator-prod'

resource serviceBusNamespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: namespaceName
  location: location
  sku: {
    name: 'Premium'
    tier: 'Premium'
    capacity: 1
  }
  properties: {
    zoneRedundant: true
    minimumTlsVersion: '1.2'
  }
}

resource quoteIssuedTopic 'Microsoft.ServiceBus/namespaces/topics@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: 'quotes.issued'
  properties: {
    defaultMessageTimeToLive: 'P7D'
    maxSizeInMegabytes: 5120
    supportOrdering: true
    requiresDuplicateDetection: true
    duplicateDetectionHistoryTimeWindow: 'PT30M'
  }
}

resource notificationSub 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2022-10-01-preview' = {
  parent: quoteIssuedTopic
  name: 'sub-notification-service'
  properties: {
    maxDeliveryCount: 10
    lockDuration: 'PT5M'
    deadLetteringOnMessageExpiration: true
    defaultMessageTimeToLive: 'P7D'
  }
}

resource notificationSubFilter 'Microsoft.ServiceBus/namespaces/topics/subscriptions/rules@2022-10-01-preview' = {
  parent: notificationSub
  name: 'approved-quotes-only'
  properties: {
    filterType: 'SqlFilter'
    sqlFilter: {
      sqlExpression: 'data.status = \'APPROVED\''
    }
  }
}
```

---

## Sequence Diagram — Quote Creation + Event Publishing

```
Client          Quotes Aggregator      Service Bus (quotes.issued)
  │                    │                          │
  │  POST /api/v1/quotes│                          │
  │──────────────────► │                          │
  │                    │  validate + createQuote   │
  │                    │◄─────────────────────────│
  │                    │                          │
  │  201 Created        │                          │
  │◄──────────────────  │                          │
  │                    │                          │
  │              (async, non-blocking)             │
  │                    │  sendMessages(QuoteIssued)│
  │                    │─────────────────────────►│
  │                    │        202 Accepted       │
  │                    │◄─────────────────────────│
  │                    │  (event stored in topic)  │
```

---

## Local Development

Set the following in `service/.env`:

```env
SERVICE_BUS_CONNECTION_STRING=Endpoint=sb://localhost:5672;SharedAccessKeyName=...
SERVICE_BUS_TOPIC_NAME=quotes.issued
```

For local testing without Azure, disable Service Bus integration by leaving
`SERVICE_BUS_CONNECTION_STRING` and `SERVICE_BUS_NAMESPACE` both unset.
The publisher will log a debug warning and skip silently.

---

## Future Enhancements

| Enhancement | Description |
|---|---|
| **Transactional Outbox** | Store event in DB atomically with the quote row; separate relay process publishes to SB |
| **Event Grid integration** | Forward `QuoteIssued` from Service Bus to Azure Event Grid for fan-out to webhooks |
| **Schema Registry** | Register `QuoteIssued/v1` schema in Azure Schema Registry for contract enforcement |
| **Private Endpoint** | Lock Service Bus to VNet private endpoint, no public internet access |
