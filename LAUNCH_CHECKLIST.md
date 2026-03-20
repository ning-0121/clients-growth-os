# AI 智能订单管理系统 — Launch Readiness

## Bugs fixed (this pass)

| # | Issue | Fix |
|---|--------|-----|
| 1 | **Build failure** — `middleware.ts` TypeScript: `cookiesToSet` and `remove(name, options)` implicitly had `any` type | Added explicit types: `setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> })`, `remove(name: string, options?: Record<string, unknown>)` |
| 2 | **Dashboard placeholder** — `/dashboard` was minimal test content only | Restored full dashboard: 我的节拍 list by `role_owner`, StageCard grid, Navbar, empty state with link to create order |

## Core flow verification (what exists in codebase)

- **Login** — ✅ LoginForm (client), auth actions, middleware redirect when unauthenticated.
- **Create order** — ✅ `/orders/new`, `createOrder` server action, inserts order + 8 stages with SLA.
- **Generate milestones** — ✅ Automatic: 8 stages (PO确认→发货完成) created on order creation with due_at chain.
- **Assign owner** — ✅ Each stage has `role_owner` (销售/财务/采购/生产/质检); dashboard shows stages by current user role.
- **Upload evidence** — ❌ Not implemented (no evidence fields or upload UI).
- **Request delay** — ❌ Not implemented (no delay request/approval flow).
- **Approve delay** — ❌ Not implemented.
- **Risk on CEO/admin** — ✅ Admin page: 卡点榜 (by role), 风险订单列表, status counts; risk/超期 from `markInProgress` / `blockStage`.

## Role views

- **Admin** — Sees: 老板总览 (`/admin`) with global stats, 卡点榜, 风险订单列表, 所有订单; Navbar shows 老板总览 only when `profiles.role === '管理员'`.
- **Staff** — Sees: 我的节拍 (dashboard, stages where `role_owner` = own role), 订单列表, 订单详情; can complete/进行中/卡住 only on stages they own or as admin.

## Not implemented (remaining launch risks)

- **Evidence gates** — No enforcement of “evidence required” on critical milestones; no upload or verification step.
- **Shipping sample dependency** — No rule enforcing “sample must ship before booking/shipment”; no dependency checks between stages.
- **Request/approve delay** — No delay request or approval workflow; only 卡住 + block_reason and status risk/超期.

## Exact smoke test checklist

1. **Auth**
   - [ ] Open `/dashboard` while logged out → redirects to `/login`.
   - [ ] Log in with valid email/password → redirects to `/dashboard`.
   - [ ] Log out → redirects to `/login`.
   - [ ] As admin, 老板总览 link visible and `/admin` loads; as non-admin, no 老板总览 (or redirect from `/admin` to dashboard).

2. **Create order**
   - [ ] Go to 订单列表 → 新建订单.
   - [ ] Submit form (order_no, customer, order_type, etd_date) → redirects to 订单详情 for new order.
   - [ ] Order detail shows 8 stages; first stage is 进行中, rest 未开始; first stage has started_at and a 开始 log in 节拍记录.

3. **Stages**
   - [ ] On order detail, as the role that owns a 进行中 stage: 已完成 / 进行中 / 卡住 buttons work.
   - [ ] 已完成 on first stage → stage becomes 已完成, second stage becomes 进行中 and gets 开始 log.
   - [ ] 已完成 on last (8th) stage → order status becomes 已完成.
   - [ ] 卡住 → enter reason, stage 卡住, order status 超期; 节拍记录 shows 卡住.
   - [ ] 进行中 (when not overdue) → order status 风险; log shows 进行中.

4. **Dashboard**
   - [ ] 我的节拍 shows only stages where role_owner matches current user role; can complete/进行中/卡住 where allowed.

5. **Admin**
   - [ ] 老板总览: stats (总订单数, 正常, 风险, 超期, 已完成), 卡点榜 table (角色, 卡住数, 进行中超期数), 风险订单列表 (order_no, 客户, 交期, 当前节拍, 负责角色, 超期时长).
   - [ ] 所有订单 lists orders with cards linking to 订单详情.

6. **No broken UI**
   - [ ] No console errors on login, dashboard, order list, order detail, admin.
   - [ ] 节拍记录 on order detail loads and shows time, role, stage name, action, note.

## Vercel deployment

- **Build** — `npm run build` passes (verified).
- **Env** — Set in Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **No `vercel.json`** required; Next.js 14 App Router is supported by default.
- **GitHub** — Push repo; in Vercel connect repo and deploy. Root directory is project root; build command `npm run build`; output: default (`.next`).

## Summary

- **Fixed:** Build (middleware types), dashboard restored to full 我的节拍 view.
- **Risks:** Evidence gates, sample-before-ship rule, and delay request/approve are not in codebase; treat as post-launch or scope clarification.
- **Smoke test:** Use checklist above before go-live.
