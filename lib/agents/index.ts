/**
 * Agent System Entry Point — Registers all agents and exports pipeline runners.
 *
 * System Architecture:
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                    AI Agent Orchestrator                        │
 * ├─────────────────────────────┬───────────────────────────────────┤
 * │   OUTBOUND (主动搜索)        │   INBOUND (宣传引流)              │
 * │                             │                                   │
 * │   ┌─────────────┐          │   ┌──────────────┐               │
 * │   │ Lead Hunter  │──┐       │   │ SEO Optimizer │               │
 * │   └─────────────┘  │       │   └──────────────┘               │
 * │   ┌──────────────┐ │       │   ┌─────────────────┐            │
 * │   │ Classifier   │◄┘       │   │ Social Publisher │            │
 * │   └──────────────┘         │   └─────────────────┘            │
 * │   ┌──────────────┐         │   ┌────────────────┐             │
 * │   │ Analyzer     │         │   │ Auto-Responder │──┐           │
 * │   └──────────────┘         │   └────────────────┘  │           │
 * │   ┌─────────────────┐      │   ┌───────────────┐   │          │
 * │   │ Strategy Planner│      │   │ Lead Capturer │◄──┘          │
 * │   └─────────────────┘      │   └───────────────┘              │
 * │   ┌────────────────┐       │          │                        │
 * │   │ Email Composer │       │          ▼                        │
 * │   └────────────────┘       │   ┌──────────────┐               │
 * │   ┌──────────────────┐     │   │ Classifier   │ (shared)      │
 * │   │ Follow-up Tracker│     │   └──────────────┘               │
 * │   └──────────────────┘     │                                   │
 * │          │                 │                                   │
 * │          ▼                 │          ▼                        │
 * │   ┌──────────────┐        │   ┌──────────────┐               │
 * │   │  客户池 Pool  │◄───────┼───│  客户池 Pool  │               │
 * │   └──────────────┘        │   └──────────────┘               │
 * └─────────────────────────────┴───────────────────────────────────┘
 */

import { registerAgent } from './registry';

// Outbound agents
import { leadHunterAgent } from './outbound/lead-hunter';
import { leadClassifierAgent } from './outbound/lead-classifier';
import { leadAnalyzerAgent } from './outbound/lead-analyzer';
import { strategyPlannerAgent } from './outbound/strategy-planner';
import { emailComposerAgent } from './outbound/email-composer';
import { followUpTrackerAgent } from './outbound/follow-up-tracker';

// Inbound agents
import { autoResponderAgent } from './inbound/auto-responder';
import { leadCapturerAgent } from './inbound/lead-capturer';
import { seoOptimizerAgent } from './inbound/seo-optimizer';
import { socialPublisherAgent } from './inbound/social-publisher';

// Register all agents
export function initializeAgents() {
  // Outbound pipeline
  registerAgent(leadHunterAgent);
  registerAgent(leadClassifierAgent);
  registerAgent(leadAnalyzerAgent);
  registerAgent(strategyPlannerAgent);
  registerAgent(emailComposerAgent);
  registerAgent(followUpTrackerAgent);

  // Inbound pipeline
  registerAgent(autoResponderAgent);
  registerAgent(leadCapturerAgent);
  registerAgent(seoOptimizerAgent);
  registerAgent(socialPublisherAgent);
}

// Auto-initialize on import
initializeAgents();

// Re-export for convenience
export { runOutboundPipeline, runInboundPipeline } from './orchestrator';
export { getAgent, getAllAgents, getAgentsByPipeline } from './registry';
export type { AgentRole, AgentTask, PipelineType, SearchCriteria, SocialContent, SEOAnalysis } from './types';
