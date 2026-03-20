# 04 — Integration Rules

## Why Event-Driven

Modules must remain independently deployable and sellable. If Order OS directly queries the `deals` table, it cannot function without Growth OS installed. Event-driven integration preserves module boundaries:

- **Producer** emits an event and forgets. It does not know or care who consumes it.
- **Consumer** reads events addressed to it and acts within its own tables.
- **No shared mutable state.** Each module's database is its own.

---

## The Draft-First Principle

**When a cross-module event triggers object creation, the consumer MUST create a draft object — never a final/active object directly.**

Why:
- Cross-module data may be incomplete or require human review
- Automatic creation of active objects bypasses the evidence-based execution principle
- Drafts give the receiving team a chance to validate before committing

How it works:
1. Module A emits event (e.g., `DEAL_WON`)
2. Module B consumes event and creates object with `status: 'draft'`
3. A human in Module B reviews the draft
4. Human explicitly confirms → status changes to active (e.g., `'正常'`)

**There are no exceptions to this rule.** Even if the source data is complete and trusted, the receiving module creates a draft first.

---

## IntegrationEvent — The Only Cross-Module Channel

`integration_events` is the ONLY allowed communication channel between modules. No module may write to another module's tables under any condition.

### Event Contract Format

Every event must contain:

```json
{
  "id": "uuid",
  "event_type": "DEAL_WON",
  "source_module": "growth_os",
  "target_module": "order_os",
  "payload": {
    "deal_id": "uuid",
    "customer_name": "Acme Corp",
    "customer_po": "PO-2026-001",
    "order_type": "大货单",
    "quantity": 5000,
    "etd_date": "2026-06-15"
  },
  "idempotency_key": "deal_won_abc123",
  "status": "pending",
  "created_at": "2026-03-18T10:00:00Z"
}
```

### Field Definitions

| Field | Required | Purpose |
|-------|----------|---------|
| `event_type` | Yes | Machine-readable event name. Uppercase, underscore-separated. |
| `source_module` | Yes | Which module emitted the event. |
| `target_module` | Yes | Which module should consume it. Use `*` for broadcast. |
| `payload` | Yes | JSON object with event-specific data. Schema defined per event type. |
| `idempotency_key` | Yes | Unique key to prevent duplicate processing. Typically `{event_type}_{source_entity_id}`. |
| `status` | Yes | `pending` → `processed` or `failed` → `dead_letter` |
| `created_at` | Yes | Emission timestamp. |
| `processed_at` | No | Set by consumer when processing completes. |
| `error_message` | No | Set by consumer if processing fails. |

---

## `integration_events` Table Schema

```sql
CREATE TABLE IF NOT EXISTS integration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  source_module text NOT NULL,
  target_module text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processed', 'failed', 'dead_letter')),
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  error_message text
);

CREATE INDEX idx_integration_events_status
  ON integration_events(target_module, status)
  WHERE status = 'pending';

CREATE INDEX idx_integration_events_type
  ON integration_events(event_type, created_at DESC);
```

---

## Producer Rules

1. **Fire and forget.** Producer emits the event and continues. It does not wait for the consumer.
2. **Include all data the consumer needs.** The consumer should not need to query back into the producer's tables.
3. **Set idempotency_key.** Use `{event_type}_{source_entity_id}` to prevent duplicates.
4. **Never assume consumption order.** Events may be processed out of order.

---

## Consumer Rules

1. **Idempotent processing.** If the same event is delivered twice, the result must be identical. Check `idempotency_key` before acting.
2. **Draft-first.** Cross-module object creation always produces a draft. See above.
3. **Update event status.** Set `status = 'processed'` and `processed_at` on success. Set `status = 'failed'` and `error_message` on failure.
4. **Own-table writes only.** Consumer writes to its own tables. Never to the producer's tables.

---

## Intelligence Layer Rules

The Intelligence Layer has additional constraints beyond normal modules:

1. **MUST NOT write directly into any business table** — not orders, not leads, not deals, not stages. No exceptions.
2. **Can only emit recommendations or events** into `integration_events` or its own `recommendations` table.
3. **Read-only access** to all business tables via RLS-controlled SELECT.
4. **Recommendations are suggestions, not commands.** The receiving module decides whether to act on them.

---

## Forbidden Patterns

| Pattern | Why Forbidden |
|---------|---------------|
| Module A writes to Module B's table | Breaks module sovereignty. Use events. |
| Module A reads Module B's table and joins against it in a query | Creates deployment dependency. Copy needed data into events. |
| Cross-module event creates a final/active object | Violates draft-first. Always create drafts. |
| Skipping `idempotency_key` | Allows duplicate processing on retry. |
| Intelligence Layer writing to business tables | Intelligence Layer is read-only + event-emitting. |
| Using REST API calls between modules instead of events | Creates synchronous coupling. Use the event table. |
| Deleting or updating `integration_events` rows after processing | Events are append-only audit trail. Only `status`, `processed_at`, `error_message` may be updated. |

---

## Error Handling

### On Consumer Failure

1. Set `status = 'failed'` and `error_message` on the event row.
2. Log the error in the consumer module's own audit log.
3. Failed events can be retried manually or by a scheduled job.

### Dead Letter

After 3 failed processing attempts, set `status = 'dead_letter'`. Dead-lettered events require manual investigation and resolution. They appear in the admin dashboard for review.

### Retry Policy

- Automated retry: up to 3 attempts with exponential backoff (1min, 5min, 30min).
- After 3 failures: dead_letter. No further automated retry.
- Manual retry: admin can reset status to `pending` to re-trigger processing.
