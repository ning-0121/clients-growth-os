# 02 — Modules Map

## Module Boundary Diagram

```
┌─────────────────────────────────────────────────────────┐
│                  Intelligence Layer                     │
│  (Capacity · Strategy · Portfolio · LTV · Orchestrator) │
│         reads from all modules — writes to none         │
│         emits recommendations + events only             │
└────────────┬──────────────┬──────────────┬──────────────┘
             │ reads        │ reads        │ reads
     ┌───────▼───────┐ ┌───▼────────┐ ┌───▼──────────┐
     │   Growth OS   │ │  Order OS  │ │ Production OS│
     │  (leads,      │ │  (orders,  │ │  (BOM, QC,   │
     │   outreach,   │ │  stages,   │ │   scheduling,│
     │   deals)      │ │  execution)│ │   factory)   │
     └───────┬───────┘ └─────┬──────┘ └──────┬───────┘
             │               │               │
             └───────┬───────┴───────┬───────┘
                     ▼               ▼
              integration_events (event bus)
              (ONLY cross-module channel)
```

Each module owns its own tables. No module reads from or writes to another module's tables directly. All cross-module communication flows through `integration_events`.

---

## Order OS

**Purpose:** Execution control system for all orders after confirmation.

**Status:** Live (testing)

**Features:**
- Order creation with auto-generated 8-stage milestones
- Role-based stage ownership (销售 / 财务 / 采购 / 生产 / 质检)
- SLA-based due dates (sample vs. bulk)
- Stage progression with evidence logging
- File attachments (Customer PO, Production Order, Packing Info)
- CEO War Room (admin dashboard)
- My Today (personal task view by role)
- Exception tracking
- Warehouse workbench

**Owned Tables:**
- `orders`
- `stages`
- `stage_logs`
- `order_logs`
- `order_attachments`
- `materials_bom`
- `outsource_jobs`
- `qc_records`
- `packing_lists`
- `packing_list_lines`
- `shipment_confirmations`
- `issue_slips`
- `exceptions`

**Routes:**
- `/orders`, `/orders/new`, `/orders/[id]`
- `/dashboard` (My Today)
- `/admin` (CEO War Room)
- `/warehouse`
- `/exceptions`

---

## Growth OS

**Purpose:** Customer acquisition and conversion system.

**Status:** In development

**Sub-modules:**

### Lead Intake Engine
- Multi-source lead generation (IG / LinkedIn / website / customs data)
- Filtering (website + product match + contact path)
- Scoring: quality, opportunity, reachability
- Grade: A / B+ / B / C

### Outreach System
- Forced sequence: Email → LinkedIn → Follow-up → Call
- Evidence required for every step
- AI-assisted message generation
- Reply validation (meaningful vs. noise)

### Deal System
- Stages: Quotation → Sample → Trial → Bulk
- Evidence-driven stage progression
- Meeting scheduling

**Owned Tables (planned):**
- `leads`
- `lead_scores`
- `outreach_sequences`
- `outreach_steps`
- `outreach_evidence`
- `deals`
- `deal_stages`
- `deal_logs`

---

## Production OS (Planned)

**Purpose:** Factory-floor execution control — from confirmed production order to finished goods.

**Status:** Planned. Some data structures exist in Order OS today (`materials_bom`, `outsource_jobs`, `qc_records`) and may migrate to Production OS when it becomes a standalone module.

**Anticipated Scope:**
- BOM execution tracking (material arrival, consumption)
- Factory production scheduling
- QC workflow (inline, mid, final inspection)
- Outsource job management
- Yield and defect tracking

**Anticipated Tables:**
- `production_orders`
- `production_schedules`
- `production_logs`
- `qc_inspections` (may absorb current `qc_records`)
- `material_receipts`
- `defect_records`

**Integration point:** Order OS emits event after finance approval → Production OS creates draft production order.

---

## Intelligence Layer

**Purpose:** Cross-cutting decision engine that reads from all modules and provides recommendations. Not a standalone product — it enhances the other modules.

**Sub-modules:**

| Sub-module | Purpose |
|------------|---------|
| Capacity Engine | Role-based slot limits (CEO: 3, Senior: 6, SDR: 10) |
| Strategy Engine | Deterministic decision tree based on reply status, intent, deal stage, capacity |
| Portfolio System | Customer mix management, concentration/mismatch risk detection |
| LTV System | Customer lifetime value based on frequency, AOV, recency |
| Orchestrator | Daily task selection within hard limits |

**Hard Constraints:**
- MUST NOT write directly into any business table (orders, leads, deals, stages, etc.)
- Can ONLY emit recommendations or events into `integration_events`
- Reads from all module tables (read-only access via RLS)
- Owns no core business objects

**Owned Tables (planned):**
- `recommendations` (output of strategy/orchestrator)
- `capacity_slots` (current allocation state)

---

## Module Ownership Rules

1. **Each module owns its tables.** No other module may INSERT, UPDATE, or DELETE rows in tables it does not own.
2. **Cross-module reads are allowed** through RLS-controlled SELECT access, but should be minimized.
3. **Cross-module writes are forbidden.** All cross-module data flow goes through `integration_events`.
4. **Intelligence Layer is read-only** against all business tables. It emits recommendations/events, never mutates business state.
5. **Shared tables** (`profiles`, `integration_events`) are platform-level — owned by the platform, not by any module.
