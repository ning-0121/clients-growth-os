# 03 — Shared Data Model

## Core Objects

Nine core objects define the data model across the platform. Each object has a single owner module. Other modules interact through events — never direct writes.

---

### 1. Customer

**Meaning:** The business entity being served — a company or buyer that places orders or is a target for acquisition.

**Owner:** Growth OS (source of truth for customer identity and profile)

**Read access:** All modules. Order OS reads `customer_name` when creating orders. Production OS reads customer requirements.

**Write access:** Growth OS only. Other modules reference customer data but do not create or modify customer records.

**Current state:** Not yet a standalone table. Order OS stores `customer_name` as a text field on `orders`. When Growth OS launches, a `customers` table will be the canonical source, and `orders.customer_name` will reference it.

---

### 2. Lead

**Meaning:** A potential customer identified through sourcing channels, not yet converted to a deal.

**Owner:** Growth OS

**Read access:** Intelligence Layer (for scoring, portfolio analysis). Order OS does not need lead data.

**Write access:** Growth OS only.

**Key fields:** source, website, product_match, contact_path, quality_score, opportunity_score, reachability_score, grade (A/B+/B/C)

---

### 3. Deal

**Meaning:** A sales opportunity progressing through stages — from first quotation to bulk order confirmation.

**Owner:** Growth OS

**Read access:** Intelligence Layer (for strategy decisions). Order OS reads deal data only through events (e.g., `DEAL_WON` event carries the payload needed to create a draft order).

**Write access:** Growth OS only.

**Key fields:** lead_id, stage (Quotation → Sample → Trial → Bulk), evidence_count, assigned_to, status

**Integration:** When a deal reaches "Bulk" and is marked won, Growth OS emits a `DEAL_WON` event. Order OS consumes this to create a draft order.

---

### 4. Order

**Meaning:** A confirmed execution unit — represents a customer order with defined milestones, deadlines, and role-based accountability.

**Owner:** Order OS

**Read access:** All modules. Growth OS reads order status for LTV calculation. Production OS reads order details for production planning. Intelligence Layer reads for portfolio analysis.

**Write access:** Order OS only. Growth OS triggers order creation through events — Order OS creates the draft.

**Key fields:** order_no (unique), customer_name, order_type (样品单/大货单), etd_date, status (正常/风险/超期/已完成), stages (auto-generated)

**Current tables:** `orders`, `stages`, `stage_logs`, `order_logs`

---

### 5. Task (Derived — Not a Core Table)

**Meaning:** A unit of work assigned to a role with a deadline. Tasks are NOT stored as a primary table — they are derived at runtime from multiple sources.

**Derived from:**
- **Order OS:** stage records where `stage_status = '进行中'` and `role_owner` matches the current user's role → becomes a task on "My Today"
- **Growth OS:** outreach steps in the current sequence that are pending → becomes a task
- **Intelligence Layer:** orchestrator output selecting today's priority actions → becomes a task

**Owner:** No single owner. Each module generates its own tasks from its own data.

**Storage:** No `tasks` table. Tasks are computed views, not persisted objects.

**Why not a table:** Tasks are projections of existing state. Storing them separately would create sync problems. The source of truth is always the underlying object (stage, outreach_step, recommendation).

---

### 6. Evidence

**Meaning:** Proof artifact that validates a task/stage completion — a file, a log entry, a timestamp, a screenshot. Without evidence, completion is not accepted.

**Owner:** Each module owns its own evidence. Order OS owns stage completion evidence. Growth OS owns outreach evidence.

**Read access:** Intelligence Layer (to validate quality). Cross-module reads through events only.

**Write access:** Owning module only.

**Current implementation in Order OS:**
- `stage_logs` — action log with actor_id, timestamp, note (who did what when)
- `order_attachments` — files uploaded as proof (Customer PO, Production Order, Packing Info)

**Pattern for other modules:** Growth OS should follow the same convention — `outreach_evidence` table with step_id, file reference, timestamp, actor.

---

### 7. Attachment

**Meaning:** A file or document linked to a business object — PDF, image, spreadsheet, etc. Stored in Supabase Storage, referenced by a metadata record.

**Owner:** Each module owns attachments for its objects.

**Read access:** All authenticated users (controlled by RLS and storage policies).

**Write access:** Owning module only.

**Current implementation:**
- Table: `order_attachments` (order_id, file_type, file_name, file_path, uploaded_by, uploaded_at)
- Storage bucket: `order-files` (private)
- File types: `customer_po`, `production_order`, `packing_info`

**Convention for new modules:**
- Table: `{module}_attachments`
- Bucket: `{module}-files`
- Always store: original file_name, storage file_path, uploaded_by, uploaded_at

---

### 8. AuditLog

**Meaning:** Immutable record of who did what, when, and what changed. Every mutation in every module must produce an audit log entry.

**Owner:** Each module owns its own logs.

**Read access:** All authenticated users. Admin has full access. Role-filtered for non-admins.

**Write access:** Owning module only. Logs are append-only — never updated or deleted.

**Current implementation in Order OS:**
- `order_logs` — action_type, field_name, old_value (jsonb), new_value (jsonb), created_by, created_at
- `stage_logs` — stage_id, actor_id, action, note, created_at

**Convention for all modules:**

Every audit log table must include:
| Field | Type | Purpose |
|-------|------|---------|
| `id` | uuid | Primary key |
| `entity_id` | uuid | FK to the object being logged |
| `action_type` | text | What happened (CREATE, UPDATE, COMPLETE, BLOCK, etc.) |
| `field_name` | text | Which field changed (null for non-field actions) |
| `old_value` | jsonb | Previous value |
| `new_value` | jsonb | New value |
| `created_by` | uuid | Who did it |
| `created_at` | timestamptz | When |

---

### 9. IntegrationEvent

**Meaning:** A cross-module event message. This is the ONLY allowed communication channel between modules. No module may write to another module's tables under any condition — all cross-module data flow goes through this object.

**Owner:** Platform-level (shared infrastructure, not owned by any single module).

**Read access:** All modules (each module reads events addressed to it).

**Write access:** All modules can emit events. Intelligence Layer can emit recommendation events.

**Table: `integration_events`**

| Field | Type | Purpose |
|-------|------|---------|
| `id` | uuid | Primary key |
| `event_type` | text | e.g., `DEAL_WON`, `ORDER_COMPLETED`, `FINANCE_APPROVED` |
| `source_module` | text | e.g., `growth_os`, `order_os`, `production_os`, `intelligence` |
| `target_module` | text | Which module should consume this |
| `payload` | jsonb | Event data |
| `idempotency_key` | text | Prevents duplicate processing (unique) |
| `status` | text | `pending`, `processed`, `failed`, `dead_letter` |
| `created_at` | timestamptz | When emitted |
| `processed_at` | timestamptz | When consumed |
| `error_message` | text | If processing failed |

**Hard rule:** If module A needs to cause a change in module B, module A emits an IntegrationEvent. Module B reads the event and makes the change in its own tables. There is no other path.

---

## Table Ownership Map

| Table | Owner | Module |
|-------|-------|--------|
| `profiles` | Platform | Shared |
| `integration_events` | Platform | Shared |
| `orders` | Order OS | Order OS |
| `stages` | Order OS | Order OS |
| `stage_logs` | Order OS | Order OS |
| `order_logs` | Order OS | Order OS |
| `order_attachments` | Order OS | Order OS |
| `materials_bom` | Order OS* | Order OS |
| `outsource_jobs` | Order OS* | Order OS |
| `qc_records` | Order OS* | Order OS |
| `packing_lists` | Order OS | Order OS |
| `packing_list_lines` | Order OS | Order OS |
| `shipment_confirmations` | Order OS | Order OS |
| `issue_slips` | Order OS | Order OS |
| `exceptions` | Order OS | Order OS |
| `leads` | Growth OS | Growth OS |
| `lead_scores` | Growth OS | Growth OS |
| `outreach_sequences` | Growth OS | Growth OS |
| `outreach_steps` | Growth OS | Growth OS |
| `outreach_evidence` | Growth OS | Growth OS |
| `deals` | Growth OS | Growth OS |
| `deal_stages` | Growth OS | Growth OS |
| `deal_logs` | Growth OS | Growth OS |
| `production_orders` | Production OS | Production OS |
| `production_schedules` | Production OS | Production OS |
| `production_logs` | Production OS | Production OS |
| `recommendations` | Intelligence Layer | Intelligence |
| `capacity_slots` | Intelligence Layer | Intelligence |

*Tables marked with `*` may migrate to Production OS when it launches as a standalone module.
