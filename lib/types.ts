// 角色枚举
export type UserRole = '销售' | '财务' | '采购' | '生产' | '质检' | '管理员';

// 订单类型
export type OrderType = '样品单' | '大货单';

// 订单状态
export type OrderStatus = '正常' | '风险' | '超期' | '已完成';

// 节拍状态
export type StageStatus = '未开始' | '进行中' | '已完成' | '卡住';

// 节拍日志动作
export type StageAction = '开始' | '完成' | '进行中' | '卡住';

// 销售层级
export type SalesTier = 'top' | 'mid';

// 用户档案
export interface Profile {
  user_id: string;
  name: string;
  role: UserRole;
  sales_tier: SalesTier | null;
  created_at: string;
}

// 订单
export interface Order {
  id: string;
  order_no: string;
  customer_name: string;
  order_type: OrderType;
  etd_date: string; // 交期 / ETD
  status: OrderStatus;
  created_at: string;

  // 扩展字段（P0）
  style_no?: string | null;
  customer_po?: string | null;
  quantity?: number | null;
  colors?: string | null;
  size_breakdown?: string | null;
  cancel_date?: string | null;
  order_date?: string | null;
  shipment_date?: string | null;
  product_category?: string | null;
  remarks?: string | null;
  risk_level?: string | null;
  updated_at?: string | null;
}

// 订单操作日志
export interface OrderLog {
  id: string;
  order_id: string;
  action_type: string;
  field_name: string | null;
  old_value: any | null;
  new_value: any | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

// 订单节拍
export interface Stage {
  id: string;
  order_id: string;
  stage_name: string;
  role_owner: UserRole;
  seq: number;
  due_at: string;
  started_at: string | null;
  completed_at: string | null;
  stage_status: StageStatus;
  block_reason: string | null;
  updated_at: string;
}

// 附件类型
export type AttachmentFileType = 'customer_po' | 'production_order' | 'packing_info';

// 订单附件
export interface OrderAttachment {
  id: string;
  order_id: string;
  file_type: AttachmentFileType;
  file_name: string;
  file_path: string;
  uploaded_by: string | null;
  uploaded_at: string;
}

// 节拍日志
export interface StageLog {
  id: string;
  stage_id: string;
  actor_id: string | null;
  action: StageAction;
  note: string | null;
  created_at: string;
}

// ── Growth OS ──

export type LeadGrade = 'A' | 'B+' | 'B' | 'C';
export type LeadStatus = 'new' | 'qualified' | 'disqualified' | 'converted';
export type DealStage = '报价' | '样品' | '试单' | '大货';
export type DealStatus = 'active' | 'won' | 'lost';

export type LeadSource = 'ig' | 'linkedin' | 'website' | 'customs' | 'referral' | 'test_batch';

export interface GrowthLead {
  id: string;
  company_name: string;
  contact_name: string | null;
  source: LeadSource | null;
  website: string | null;
  product_match: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  instagram_handle: string | null;
  quality_score: number;
  opportunity_score: number;
  reachability_score: number;
  final_score: number;
  grade: LeadGrade | null;
  status: LeadStatus;
  assigned_to: string | null;
  assigned_at: string | null;
  first_touch_at: string | null;
  last_action_at: string | null;
  next_action_due: string | null;
  action_count: number;
  disqualified_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RawLeadInput {
  company_name: string;
  contact_name?: string;
  source: LeadSource;
  website?: string;
  product_match?: string;
  contact_email?: string;
  contact_linkedin?: string;
  instagram_handle?: string;
}

// Lead actions
export type LeadActionType = 'email' | 'social_outreach' | 'call' | 'reject' | 'return' | 'reply' | 'promote';

export interface GrowthLeadAction {
  id: string;
  lead_id: string;
  action_type: LeadActionType;
  note: string | null;
  evidence_json: Record<string, any>;
  created_by: string | null;
  created_at: string;
}

export type IntakeTriggerType = 'auto_scrape' | 'test_batch' | 'api' | 'manual';

export interface IntakeRun {
  id: string;
  trigger_type: IntakeTriggerType;
  created_by: string | null;
  total: number;
  qualified: number;
  disqualified: number;
  duplicates: number;
  created_at: string;
}

export interface GrowthDeal {
  id: string;
  lead_id: string | null;
  customer_name: string;
  deal_stage: DealStage;
  status: DealStatus;
  owner_id: string | null;
  estimated_order_value: number | null;
  product_category: string | null;
  style_no: string | null;
  notes: string | null;
  won_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Integration Layer ──

export type IntegrationEventStatus = 'pending' | 'processed' | 'failed' | 'dead_letter';
export type OrderDraftStatus = 'pending' | 'confirmed' | 'rejected';

export interface IntegrationEvent {
  id: string;
  event_type: string;
  source_module: string;
  target_module: string;
  payload: Record<string, any>;
  idempotency_key: string;
  status: IntegrationEventStatus;
  created_at: string;
  processed_at: string | null;
  error_message: string | null;
}

export interface OrderDraft {
  id: string;
  event_id: string | null;
  source_deal_id: string;
  source_lead_id: string | null;
  customer_name: string;
  owner_id: string | null;
  estimated_order_value: number | null;
  product_category: string | null;
  style_no: string | null;
  notes: string | null;
  snapshot_payload: Record<string, any>;
  status: OrderDraftStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
  rejected_reason: string | null;
  created_order_id: string | null;
  created_at: string;
}
