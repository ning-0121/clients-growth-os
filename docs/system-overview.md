# SYSTEM OVERVIEW — AI 智能订单管理系统

**Product name:** AI 智能订单管理系统（对外品牌名；内部执行内核仍称 Order OS / 订单节拍逻辑）

This system consists of three core modules:

---

## 1. Order OS (Order Metronome)

Purpose:
Execution control system for all orders.

Core features:
- Order creation (PO required at creation)
- Milestone-based execution (timeline)
- Evidence-based completion (no fake completion)
- Delay request system
- Department responsibility tracking (sales / sourcing / production / finance / QC)
- CEO War Room (decision system)
- My Today (execution system)

Core principle:
→ Behavior-driven execution (no skipping steps)

---

## 2. Growth OS (Customer Development System)

Purpose:
Customer acquisition + conversion system.

Modules:

### Lead Intake Engine
- Multi-source lead generation (IG / LinkedIn / website / customs data)
- Filtering (must have website + product match + contact path)
- Scoring:
  - Quality score
  - Opportunity score
  - Reachability score
- Grade: A / B+ / B / C

### Outreach System
- Forced sequence:
  Email → LinkedIn → Follow-up → Call
- Evidence required for every step
- AI-assisted message generation
- Reply validation (meaningful vs noise)

### Deal System
- Stages:
  Quotation → Sample → Trial → Bulk
- Evidence-driven stage progression
- Meeting scheduling system

---

## 3. Growth OS Intelligence Layer (V2.8+)

### Capacity Engine
- Role-based capacity:
  CEO / Senior / SDR
- Hard slot limits
- Queue system

### Strategy Engine
- Deterministic decision tree
- Based on:
  - reply status
  - intent
  - deal stage
  - capacity
  - override

### Portfolio System
- Customer mix management
- Risk detection:
  - concentration
  - mismatch
  - low value load

### LTV System
- Based on:
  - frequency
  - AOV
  - recency

### Orchestrator
- Selects daily tasks
- Hard limits:
  CEO: 3
  Senior: 6
  SDR: 10

---

## SYSTEM PRINCIPLES

1. Deterministic (no randomness)
2. Evidence-based (no fake actions)
3. Behavior-driven (not data dashboard)
4. No free-form actions (only structured steps)
5. System assists execution, not replaces humans

---

## CURRENT STATUS

- Order OS: in testing
- Growth OS: in development (Lead Intake + Outreach working)
- CEO War Room: live
- My Today: live

