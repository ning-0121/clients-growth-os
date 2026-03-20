# 05 — Integration Roadmap

## Phases Overview

| Phase | Integration | Direction | Status |
|-------|-------------|-----------|--------|
| Phase 1 | Growth OS → Order OS | Deal won → draft order | Next |
| Phase 2 | Order OS → Growth OS | Order completed → LTV / reorder signals | Planned |
| Phase 3 | Order OS → Production OS | Finance approved → draft production order | Planned |
| Phase 4 | Intelligence Layer | Reads from all, emits recommendations | Planned |

---

## Phase 1: Growth OS → Order OS

**Trigger:** A deal in Growth OS reaches "Bulk" stage and is marked as won.

**Goal:** Automatically create a draft order in Order OS with the deal's data, for human confirmation.

### Event: `DEAL_WON`

```json
{
  "event_type": "DEAL_WON",
  "source_module": "growth_os",
  "target_module": "order_os",
  "payload": {
    "deal_id": "uuid",
    "lead_id": "uuid",
    "customer_name": "Acme Corp",
    "customer_po": "PO-2026-001",
    "order_type": "大货单",
    "quantity": 5000,
    "style_no": "SS2026-001",
    "product_category": "T恤",
    "etd_date": "2026-06-15",
    "remarks": "First bulk order from this customer",
    "deal_owner_id": "uuid"
  },
  "idempotency_key": "deal_won_{deal_id}"
}
```

### Consumer Behavior (Order OS)

1. Read the `DEAL_WON` event from `integration_events` where `target_module = 'order_os'` and `status = 'pending'`.
2. Check `idempotency_key` — skip if already processed.
3. Create a new order with `status: 'draft'`:
   - Map `payload.customer_name` → `orders.customer_name`
   - Map `payload.customer_po` → `orders.customer_po`
   - Map `payload.order_type` → `orders.order_type`
   - Map `payload.etd_date` → `orders.etd_date`
   - Generate `order_no` using existing convention
   - Set `status = 'draft'` (new status value — does NOT auto-generate stages)
   - Store `deal_id` in `orders.source_deal_id` for traceability
4. Write `order_logs` entry: `action_type = 'CREATE_DRAFT_FROM_DEAL'`
5. Update event: `status = 'processed'`, `processed_at = now()`

### What Does NOT Happen Automatically

- Stages are NOT auto-generated for draft orders. Stages are only created when a human confirms the draft → `status = '正常'`.
- Customer PO file is NOT uploaded. The sales team must attach it manually during confirmation.
- No notifications are sent. The draft appears in the order list with a "draft" badge.

### Changes Required in Order OS

| Change | Description |
|--------|-------------|
| Add `'draft'` to `OrderStatus` type | `'正常' \| '风险' \| '超期' \| '已完成' \| 'draft'` |
| Add `source_deal_id` column to `orders` | `uuid`, nullable, for traceability back to Growth OS |
| Add draft confirmation action | Server action that changes `status` from `'draft'` to `'正常'` and triggers stage generation |
| Add event consumer | Scheduled job or webhook that reads pending events for `order_os` |
| Filter drafts in order list | Show draft orders with distinct visual treatment |

### Changes Required in Growth OS

| Change | Description |
|--------|-------------|
| Emit `DEAL_WON` event | When deal status → won, insert into `integration_events` |
| Include all required fields in payload | Customer name, PO, type, quantity, ETD, etc. |

---

## Phase 2: Order OS → Growth OS

**Trigger:** An order is completed (all 8 stages finished, `status = '已完成'`).

**Goal:** Feed completion data back to Growth OS for LTV calculation and reorder detection.

### Event: `ORDER_COMPLETED`

```json
{
  "event_type": "ORDER_COMPLETED",
  "source_module": "order_os",
  "target_module": "growth_os",
  "payload": {
    "order_id": "uuid",
    "order_no": "ORD-2026-042",
    "customer_name": "Acme Corp",
    "source_deal_id": "uuid or null",
    "order_type": "大货单",
    "quantity": 5000,
    "completed_at": "2026-08-10T14:00:00Z",
    "total_duration_hours": 2160,
    "exceptions_count": 1
  },
  "idempotency_key": "order_completed_{order_id}"
}
```

### Consumer Behavior (Growth OS)

1. Update customer LTV data (frequency, recency, AOV).
2. Check reorder patterns — if customer has ordered 3+ times, flag as repeat buyer.
3. If `source_deal_id` is present, update the deal record with fulfillment status.

---

## Phase 3: Order OS → Production OS

**Trigger:** Finance approval stage (Stage 2: 财务审核) is completed in Order OS.

**Goal:** Create a draft production order in Production OS for factory scheduling.

### Event: `FINANCE_APPROVED`

```json
{
  "event_type": "FINANCE_APPROVED",
  "source_module": "order_os",
  "target_module": "production_os",
  "payload": {
    "order_id": "uuid",
    "order_no": "ORD-2026-042",
    "customer_name": "Acme Corp",
    "order_type": "大货单",
    "quantity": 5000,
    "style_no": "SS2026-001",
    "etd_date": "2026-06-15",
    "approved_at": "2026-03-20T09:00:00Z",
    "approved_by": "uuid"
  },
  "idempotency_key": "finance_approved_{order_id}"
}
```

### Consumer Behavior (Production OS)

1. Create draft production order with BOM placeholder.
2. Production team reviews and fills in BOM details, scheduling.
3. Draft confirmation triggers production scheduling.

**Note:** This aligns with the existing requirement that production order upload happens within 2 days after finance approval.

---

## Phase 4: Intelligence Layer

**Trigger:** Intelligence Layer reads events and business data from all modules on a scheduled basis.

**Goal:** Emit recommendations — not direct mutations.

### Events Consumed (Read-Only)

| Event | What Intelligence Layer Does |
|-------|------------------------------|
| `DEAL_WON` | Updates portfolio concentration analysis |
| `ORDER_COMPLETED` | Updates LTV model, capacity forecasting |
| `FINANCE_APPROVED` | Updates production capacity planning |
| `STAGE_BLOCKED` (future) | Triggers risk alert recommendation |

### Events Emitted

| Event | Target | Purpose |
|-------|--------|---------|
| `RECOMMENDATION_CAPACITY_ALERT` | `growth_os` | "Capacity full — pause new deal intake" |
| `RECOMMENDATION_REORDER_OPPORTUNITY` | `growth_os` | "Customer X hasn't ordered in 90 days" |
| `RECOMMENDATION_RISK_ESCALATION` | `order_os` | "Order Y has 3 blocked stages — escalate to CEO" |

**All recommendations are suggestions.** The receiving module decides whether to surface them to users or act on them.

---

## Migration Checklist Per Phase

### Before Starting Any Phase

- [ ] `integration_events` table exists in production
- [ ] Event consumer mechanism is implemented (cron job, edge function, or webhook)
- [ ] Dead letter monitoring is set up in admin dashboard

### Phase 1 Checklist

- [ ] Growth OS: `DEAL_WON` event emission implemented
- [ ] Order OS: `'draft'` status added to `OrderStatus`
- [ ] Order OS: `source_deal_id` column added to `orders`
- [ ] Order OS: Event consumer reads and processes `DEAL_WON`
- [ ] Order OS: Draft confirmation flow (draft → 正常 + stage generation)
- [ ] Order OS: Draft orders visible in order list with distinct badge
- [ ] Order OS: `order_logs` entry for `CREATE_DRAFT_FROM_DEAL`
- [ ] End-to-end test: deal won in Growth OS → draft appears in Order OS → human confirms → stages generated

### Phase 2 Checklist

- [ ] Order OS: `ORDER_COMPLETED` event emission on last stage completion
- [ ] Growth OS: Event consumer reads `ORDER_COMPLETED`
- [ ] Growth OS: LTV calculation updated with order data
- [ ] Growth OS: Reorder detection logic implemented

### Phase 3 Checklist

- [ ] Order OS: `FINANCE_APPROVED` event emission on Stage 2 completion
- [ ] Production OS: Core tables created
- [ ] Production OS: Event consumer reads `FINANCE_APPROVED`
- [ ] Production OS: Draft production order creation flow
- [ ] Production OS: BOM and scheduling UI

### Phase 4 Checklist

- [ ] Intelligence Layer: Read access to all module tables via RLS
- [ ] Intelligence Layer: Scheduled analysis jobs
- [ ] Intelligence Layer: Recommendation event emission
- [ ] All modules: Recommendation display in relevant dashboards
