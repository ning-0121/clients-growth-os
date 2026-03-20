# 00 — Master Overview

## What This Platform Is

This platform is a suite of independently sellable modules for export/trading companies. Each module solves a distinct business problem. Modules communicate through a shared event bus — never through direct database access.

---

## Modules

| Module | Type | Status | Core Problem |
|--------|------|--------|--------------|
| **Order OS** | Sellable product | Live (testing) | Order execution control — milestone tracking, role-based accountability, evidence-driven completion |
| **Growth OS** | Sellable product | In development | Customer acquisition + conversion — lead intake, outreach sequencing, deal progression |
| **Production OS** | Sellable product | Planned | Factory-floor execution — BOM tracking, production scheduling, QC workflow |
| **Intelligence Layer** | Cross-cutting layer | Partial | Shared decision engine — capacity, strategy, portfolio, LTV. Not a standalone product. Reads from all modules, writes to none. |

Each module can be deployed and sold independently. A customer can buy Order OS without Growth OS. Integration between modules is additive — it enhances, but is never required for a module to function.

---

## Shared Infrastructure

All modules share:

- **Supabase** — database, auth, storage, RLS
- **Auth + Profiles** — single user identity with role assignment
- **Integration Events table** — the only allowed cross-module communication channel
- **Audit log pattern** — every module follows the same logging convention
- **File storage** — Supabase Storage with per-module buckets

---

## Guiding Principles

1. **Deterministic** — no randomness, no ambiguity in what happens next
2. **Evidence-based** — no fake completions, every action requires proof
3. **Behavior-driven** — system drives execution, not just displays data
4. **Event-coupled** — modules communicate through events, never direct DB access
5. **Draft-first** — cross-module events create draft objects, never final objects directly
6. **Module sovereignty** — each module owns its tables; no other module writes to them

---

## Document Index

| Doc | Purpose |
|-----|---------|
| [02 — Modules Map](./02-modules-map.md) | Boundaries, features, tables, and ownership rules per module |
| [03 — Shared Data Model](./03-shared-data-model.md) | Core objects, ownership, read/write permissions |
| [04 — Integration Rules](./04-integration-rules.md) | Event architecture, contracts, forbidden patterns |
| [05 — Integration Roadmap](./05-integration-roadmap.md) | Phased integration plan across modules |
