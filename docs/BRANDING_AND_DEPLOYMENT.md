# 品牌与部署：AI 智能订单管理系统

应用与系统的对外统一名称为：**AI 智能订单管理系统**。  
代码仓库内 `package.json` 的 npm 包名为：`ai-intelligent-order-management`。

以下平台**无法通过本仓库文件自动改名**，需在各自控制台操作。

---

## GitHub

1. 打开仓库 **Settings → General → Repository name**，将仓库名改为例如 `ai-intelligent-order-management`（或你偏好的英文名）。
2. **Settings → General** 中更新 **Description**，例如：`AI 智能订单管理系统 — Next.js + Supabase`。
3. 若使用 GitHub Actions / 环境变量中有旧项目名，请同步搜索替换。
4. 本地更新 remote（若改了仓库 URL）：
   ```bash
   git remote set-url origin https://github.com/<org>/<new-repo-name>.git
   ```

---

## Vercel

1. 登录 [Vercel Dashboard](https://vercel.com/dashboard)，进入该项目。
2. **Settings → General → Project Name**：改为与品牌一致或易识别的名称（如 `ai-order-management`）。
3. **Settings → General** 中可更新描述（若有）。
4. 生产域名若含旧名，可在 **Domains** 中新增新域名并保留旧域名跳转（可选）。
5. 环境变量 `NEXT_PUBLIC_*` 一般**无需**因改名而修改；仅当变量值里硬编码了旧产品名时再改。

---

## Supabase

1. 登录 [Supabase Dashboard](https://supabase.com/dashboard)，选择对应项目。
2. **Project Settings → General → Project name**：改为例如 `AI Order Management` 或 `ai-order-prod`（仅控制台显示，**不影响**数据库连接串与 `ref`）。
3. **注意**：  
   - 修改项目显示名**不会**改变 `SUPABASE_URL` 中的 project ref；无需改 `.env` 除非迁移项目。  
   - 若需对外展示名称出现在邮件模板等，在 **Authentication → Email Templates** 等处手动更新文案。
4. 数据库表名、RLS、迁移文件**不必**因品牌改名而批量重命名（除非你有合规要求）。

---

## 本仓库已同步的文案

- `app/layout.tsx` — 页面 `title` / `description`
- `app/login/page.tsx` — 登录页标题
- `components/Navbar.tsx` — 顶栏品牌名
- `README.md`、`LAUNCH_CHECKLIST.md`、`docs/system-overview.md`
- `package.json` / `package-lock.json` — npm `name`

若新增页面，请统一使用 **AI 智能订单管理系统** 作为产品对外名称。
