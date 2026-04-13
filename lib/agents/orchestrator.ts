/**
 * Agent Orchestrator — Executes agent pipelines step by step.
 *
 * Two main pipelines:
 * 1. OUTBOUND: lead-hunter → lead-classifier → lead-analyzer → strategy-planner → email-composer → follow-up-tracker
 * 2. INBOUND:  auto-responder → lead-capturer → lead-classifier → lead-analyzer
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { AgentContext, AgentResult, AgentRole, AgentTask, PipelineDefinition, PipelineType } from './types';
import { getAgent } from './registry';

// ── Pipeline Definitions ──

export const OUTBOUND_PIPELINE: PipelineDefinition = {
  name: '主动搜索流水线',
  type: 'outbound',
  steps: [
    { agent: 'lead-hunter', retryable: true, maxRetries: 2 },
    { agent: 'lead-classifier', retryable: true },
    { agent: 'lead-analyzer', retryable: true },
    { agent: 'strategy-planner', retryable: false },
    { agent: 'email-composer', retryable: true, maxRetries: 2 },
    { agent: 'follow-up-tracker', retryable: false },
  ],
};

export const INBOUND_PIPELINE: PipelineDefinition = {
  name: '宣传引流流水线',
  type: 'inbound',
  steps: [
    { agent: 'auto-responder', retryable: true, maxRetries: 2 },
    { agent: 'lead-capturer', retryable: true },
    { agent: 'lead-classifier', retryable: true },
    { agent: 'lead-analyzer', retryable: false },
  ],
};

// ── Task Logging ──

async function logTask(
  supabase: SupabaseClient,
  task: Partial<AgentTask>
): Promise<string> {
  const { data } = await supabase
    .from('agent_tasks')
    .insert({
      agent_role: task.agent_role,
      pipeline: task.pipeline,
      status: task.status || 'idle',
      input: task.input || {},
      lead_id: task.lead_id || null,
      parent_task_id: task.parent_task_id || null,
      metadata: task.metadata || {},
    })
    .select('id')
    .single();

  return data?.id || '';
}

async function updateTask(
  supabase: SupabaseClient,
  taskId: string,
  updates: Partial<AgentTask>
) {
  await supabase
    .from('agent_tasks')
    .update(updates)
    .eq('id', taskId);
}

// ── Pipeline Executor ──

export interface PipelineExecutionResult {
  pipeline: string;
  type: PipelineType;
  stepsCompleted: number;
  totalSteps: number;
  results: { agent: AgentRole; success: boolean; data?: Record<string, unknown>; error?: string }[];
  stoppedEarly: boolean;
  leadId?: string;
}

/**
 * Execute a full pipeline for a single lead or trigger.
 */
export async function executePipeline(
  supabase: SupabaseClient,
  pipeline: PipelineDefinition,
  initialInput: Record<string, unknown>,
  leadId?: string
): Promise<PipelineExecutionResult> {
  const result: PipelineExecutionResult = {
    pipeline: pipeline.name,
    type: pipeline.type,
    stepsCompleted: 0,
    totalSteps: pipeline.steps.length,
    results: [],
    stoppedEarly: false,
    leadId,
  };

  let previousResults: Record<string, unknown> = { ...initialInput };

  // Create parent task
  const parentTaskId = await logTask(supabase, {
    agent_role: 'orchestrator',
    pipeline: pipeline.type,
    status: 'running',
    input: initialInput,
    lead_id: leadId,
  });

  for (const step of pipeline.steps) {
    const agent = getAgent(step.agent);
    if (!agent) {
      console.warn(`[Orchestrator] Agent "${step.agent}" not registered, skipping`);
      result.results.push({ agent: step.agent, success: false, error: 'Agent not registered' });
      continue;
    }

    // Check condition
    const context: AgentContext = {
      supabase,
      taskId: parentTaskId,
      pipeline: pipeline.type,
      leadId,
      previousResults,
    };

    if (step.condition && !step.condition(context)) {
      result.results.push({ agent: step.agent, success: true, data: { skipped: true } });
      continue;
    }

    // Create sub-task
    const taskId = await logTask(supabase, {
      agent_role: step.agent,
      pipeline: pipeline.type,
      status: 'running',
      input: previousResults,
      lead_id: leadId,
      parent_task_id: parentTaskId,
    });

    // Execute with retry
    let agentResult: AgentResult | null = null;
    const maxAttempts = step.retryable ? (step.maxRetries || 1) + 1 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        agentResult = await agent.execute({ ...context, taskId });
        if (agentResult.success) break;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        agentResult = { success: false, error: errorMsg };
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    if (!agentResult) {
      agentResult = { success: false, error: 'No result from agent' };
    }

    // Update task
    await updateTask(supabase, taskId, {
      status: agentResult.success ? 'completed' : 'failed',
      output: agentResult.data,
      error: agentResult.error,
      completed_at: new Date().toISOString(),
    });

    // Apply lead updates if any
    if (agentResult.leadUpdates && leadId) {
      await supabase
        .from('growth_leads')
        .update(agentResult.leadUpdates)
        .eq('id', leadId);
    }

    result.results.push({
      agent: step.agent,
      success: agentResult.success,
      data: agentResult.data,
      error: agentResult.error,
    });

    if (agentResult.success) {
      result.stepsCompleted++;
      previousResults = { ...previousResults, ...agentResult.data };
      // Update leadId if the agent created one
      if (agentResult.data?.leadId) {
        leadId = agentResult.data.leadId as string;
        result.leadId = leadId;
      }
    }

    // Check if pipeline should stop
    if (agentResult.shouldStop || !agentResult.success) {
      result.stoppedEarly = true;
      break;
    }
  }

  // Update parent task
  await updateTask(supabase, parentTaskId, {
    status: result.stoppedEarly && result.results.some((r) => !r.success) ? 'failed' : 'completed',
    output: { stepsCompleted: result.stepsCompleted, totalSteps: result.totalSteps },
    completed_at: new Date().toISOString(),
  });

  return result;
}

/**
 * Run the outbound pipeline for a batch of search criteria.
 */
export async function runOutboundPipeline(
  supabase: SupabaseClient,
  input: Record<string, unknown>
): Promise<PipelineExecutionResult> {
  return executePipeline(supabase, OUTBOUND_PIPELINE, input);
}

/**
 * Run the inbound pipeline for an incoming inquiry.
 */
export async function runInboundPipeline(
  supabase: SupabaseClient,
  input: Record<string, unknown>,
  leadId?: string
): Promise<PipelineExecutionResult> {
  return executePipeline(supabase, INBOUND_PIPELINE, input, leadId);
}
