# Growth OS

独立仓库：**客户获客与销售执行**（线索录入、触达、统计）。与 Order OS（订单节拍器）**不共用 UI**，数据仍可通过同一 Supabase 项目与 Order 侧集成。

## 数据库迁移

**本仓库不包含 `supabase/migrations/`。** 所有 schema 变更仅在 **Order OS / 基础设施主仓库** 维护并执行。

## 路由

| 路径 | 说明 |
|------|------|
| `/` | 已登录 → `/growth/my-today`；未登录 → `/login` |
| `/login` | 登录 / 注册 |
| `/growth/my-today` | My Leads（销售、管理员） |
| `/growth/intake` | Lead Intake（销售、管理员） |
| `/growth/stats` | Growth 统计（仅管理员） |
| `/growth/leads/[id]` | 线索详情 |
| `/api/leads/intake` | 线索 intake API |

## 本地开发

```bash
npm install
cp .env.example .env.local
# 填入与 Order OS 相同的 NEXT_PUBLIC_SUPABASE_URL、NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev
```

## 部署

Vercel 新建独立 Project，环境变量与 Order OS 使用同一 Supabase 项目即可。

## 组件说明

- `components/GrowthNavbar.tsx` — **仅 Growth**，勿与 Order OS 的导航混用。
