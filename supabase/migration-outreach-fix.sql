-- ============================================================
-- Growth OS — Outreach Status Fix (补丁)
-- 确保 outreach_status 字段存在且有正确的约束
-- ============================================================

-- outreach_status 可能在之前的迁移中只加了列没加约束
-- 先确保列存在
ALTER TABLE growth_leads ADD COLUMN IF NOT EXISTS outreach_status text DEFAULT 'none';

-- 如果没有 CHECK 约束，加上（忽略已存在的错误）
DO $$
BEGIN
  ALTER TABLE growth_leads ADD CONSTRAINT chk_outreach_status
    CHECK (outreach_status IN ('none', 'enrolled', 'sequence_active', 'replied', 'opted_out', 'completed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
