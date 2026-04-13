/**
 * AI Agent System — Core Type Definitions
 *
 * The system operates as a collection of specialized AI agents,
 * organized into two main pipelines:
 *
 * 1. OUTBOUND (主动搜索): Hunt → Pool → Classify → Analyze → Strategy → Email → Track
 * 2. INBOUND  (宣传引流): SEO/Content → Social Media → Auto-Reply → Capture → Pool
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ── Agent Identity ──

export type AgentRole =
  // Outbound pipeline agents
  | 'lead-hunter'         // Search for leads on web & social media
  | 'lead-classifier'     // Classify leads into client pool categories
  | 'lead-analyzer'       // Deep analysis of lead quality & fit
  | 'strategy-planner'    // Develop personalized outreach strategy
  | 'email-composer'      // Generate & send outreach emails
  | 'follow-up-tracker'   // Track responses, schedule follow-ups
  // Inbound pipeline agents
  | 'seo-optimizer'       // Website SEO & content optimization
  | 'social-publisher'    // Social media content creation & posting
  | 'auto-responder'      // Auto-reply to inbound inquiries
  | 'lead-capturer'       // Capture & route inbound leads to pool
  // Shared agents
  | 'orchestrator';       // Pipeline coordinator

export type AgentStatus = 'idle' | 'running' | 'waiting' | 'completed' | 'failed';

export type PipelineType = 'outbound' | 'inbound';

// ── Agent Task ──

export interface AgentTask {
  id: string;
  agent_role: AgentRole;
  pipeline: PipelineType;
  status: AgentStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  parent_task_id?: string;       // For sub-tasks in a pipeline
  lead_id?: string;              // Lead this task operates on
  metadata?: Record<string, unknown>;
}

// ── Agent Context ──

export interface AgentContext {
  supabase: SupabaseClient;
  taskId: string;
  pipeline: PipelineType;
  leadId?: string;
  previousResults?: Record<string, unknown>;  // Results from previous pipeline step
}

// ── Agent Result ──

export interface AgentResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  nextAgent?: AgentRole;         // Which agent should run next in pipeline
  shouldStop?: boolean;          // Stop pipeline (e.g., lead disqualified)
  leadUpdates?: Partial<LeadUpdates>;  // Updates to apply to the lead
}

export interface LeadUpdates {
  status: string;
  grade: string;
  score: number;
  category: string;
  ai_analysis: Record<string, unknown>;
  contact_email: string;
  contact_linkedin: string;
  contact_name: string;
  notes: string;
}

// ── Agent Interface ──

export interface Agent {
  role: AgentRole;
  pipeline: PipelineType;
  description: string;
  execute(context: AgentContext): Promise<AgentResult>;
}

// ── Pipeline Definition ──

export interface PipelineStep {
  agent: AgentRole;
  condition?: (context: AgentContext) => boolean;  // Skip if returns false
  retryable?: boolean;
  maxRetries?: number;
}

export interface PipelineDefinition {
  name: string;
  type: PipelineType;
  steps: PipelineStep[];
}

// ── Lead Search Criteria (for lead-hunter agent) ──

export interface SearchCriteria {
  keywords: string[];
  platforms: ('google' | 'instagram' | 'linkedin' | 'alibaba')[];
  region?: string;
  productCategories?: string[];
  minCompanySize?: 'small' | 'medium' | 'large';
  excludeDomains?: string[];
  maxResults?: number;
}

// ── Social Media Content (for social-publisher agent) ──

export interface SocialContent {
  platform: 'instagram' | 'linkedin' | 'facebook' | 'tiktok';
  contentType: 'post' | 'story' | 'reel' | 'article';
  topic: string;
  text: string;
  hashtags?: string[];
  scheduledAt?: string;
  status: 'draft' | 'scheduled' | 'published' | 'failed';
}

// ── SEO Analysis (for seo-optimizer agent) ──

export interface SEOAnalysis {
  url: string;
  currentScore: number;
  issues: SEOIssue[];
  suggestions: SEOSuggestion[];
  keywords: KeywordAnalysis[];
}

export interface SEOIssue {
  type: 'meta' | 'content' | 'technical' | 'performance';
  severity: 'critical' | 'warning' | 'info';
  description: string;
  fix: string;
}

export interface SEOSuggestion {
  area: string;
  currentState: string;
  recommendation: string;
  impact: 'high' | 'medium' | 'low';
}

export interface KeywordAnalysis {
  keyword: string;
  searchVolume: number;
  difficulty: number;
  currentRank?: number;
  targetRank: number;
}
