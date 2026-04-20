// ── AI Analysis Types ──

export interface AIWebsiteAnalysis {
  is_apparel_company: boolean;
  confidence: number; // 0-100
  product_categories: string[];
  company_type: 'brand' | 'retailer' | 'manufacturer' | 'wholesaler' | 'other';
  scale_estimate: 'small' | 'medium' | 'large';
  product_fit_score: number; // 0-100: how well this company fits as our B2B customer
  outreach_recommendation: string; // suggested approach for sales
  key_evidence: string[]; // evidence extracted from website
  analyzed_at: string;
}

export interface AICompositeScore {
  score: number; // 0-100
  recommendation: 'pursue' | 'skip' | 'investigate';
  reasoning: string;
  suggested_approach: string;
  scored_at: string;
}

export interface AIRequestOptions {
  cacheTTL?: number; // cache TTL in ms (default: 24h)
  priority?: 'high' | 'normal' | 'low';
  model?: string; // override default model
  systemPrompt?: string;     // stable, will be prompt-cached by Anthropic (90% discount on hits)
  useCache?: boolean;        // default true — set false for non-deterministic debugging
  maxTokens?: number;        // max output tokens (default: 1024 — override for large JSON responses)
}

export interface AIUsageRecord {
  request_type: string;
  lead_id?: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

// ── Customs Types ──

export interface CustomsRecord {
  id: string;
  importer_name: string;
  exporter_name: string | null;
  hs_code: string | null;
  product_desc: string | null;
  quantity: number | null;
  weight_kg: number | null;
  value_usd: number | null;
  origin_country: string | null;
  dest_country: string | null;
  import_date: string | null;
  bill_of_lading: string | null;
  raw_data: Record<string, any>;
  created_at: string;
}

export interface CustomsTradeProfile {
  total_records: number;
  total_value_usd: number;
  avg_monthly_imports: number;
  top_hs_codes: { code: string; description: string; count: number }[];
  origin_countries: string[];
  date_range: { first: string; last: string };
  is_apparel_importer: boolean;
}

export interface CustomsMatch {
  customs_record_id: string;
  match_type: 'domain' | 'exact_name' | 'fuzzy_name' | 'ai_confirmed';
  confidence: 'exact' | 'high' | 'medium' | 'low';
}

// ── Verification Types ──

export type VerificationStatus =
  | 'none'
  | 'pending'
  | 'round_1'
  | 'round_2'
  | 'round_3'
  | 'round_4'
  | 'completed'
  | 'failed';

export interface VerificationCheck {
  name: string;
  result: 'pass' | 'fail' | 'skip' | 'warn';
  detail: string;
  data?: Record<string, any>;
}

export interface VerificationEvidence {
  round: number;
  timestamp: string;
  checks: VerificationCheck[];
}

export interface VerificationRunResult {
  processed: number;
  advanced: number;
  disqualified: number;
  failed: number;
}
