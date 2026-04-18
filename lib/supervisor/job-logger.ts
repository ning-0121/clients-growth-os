import { SupabaseClient } from '@supabase/supabase-js';

export type JobType = 'discover' | 'verify' | 'enrich' | 'analyze' | 'outreach' | 'strategy' | 'orchestrate' | 'supervisor';
export type JobStatus = 'running' | 'success' | 'error' | 'timeout' | 'partial';

/**
 * Start a job log entry. Returns the log ID so you can finish() it later.
 * Non-blocking — errors are silently ignored (supervisor shouldn't break jobs).
 */
export async function startJobLog(
  supabase: SupabaseClient,
  jobType: JobType,
  jobName: string,
  inputCount = 0
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('ai_job_logs')
      .insert({
        job_type: jobType,
        job_name: jobName,
        status: 'running',
        input_count: inputCount,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) return null;
    return data?.id || null;
  } catch {
    return null;
  }
}

interface JobResult {
  status: JobStatus;
  outputCount?: number;
  successCount?: number;
  errorCount?: number;
  errorMessage?: string;
  metadata?: Record<string, any>;
  apiCalls?: number;
  tokensUsed?: number;
  costUsd?: number;
}

/**
 * Finish a job log. Records duration, status, metrics.
 */
export async function finishJobLog(
  supabase: SupabaseClient,
  logId: string | null,
  result: JobResult
): Promise<void> {
  if (!logId) return;
  try {
    const now = new Date();

    // Calculate duration from started_at
    const { data: existing } = await supabase
      .from('ai_job_logs')
      .select('started_at')
      .eq('id', logId)
      .single();

    const durationMs = existing?.started_at
      ? now.getTime() - new Date(existing.started_at).getTime()
      : 0;

    await supabase
      .from('ai_job_logs')
      .update({
        status: result.status,
        finished_at: now.toISOString(),
        duration_ms: durationMs,
        output_count: result.outputCount || 0,
        success_count: result.successCount || 0,
        error_count: result.errorCount || 0,
        error_message: result.errorMessage?.slice(0, 2000),
        metadata: result.metadata || {},
        api_calls: result.apiCalls || 0,
        tokens_used: result.tokensUsed || 0,
        cost_usd: result.costUsd || 0,
      })
      .eq('id', logId);
  } catch {
    // Silent — don't break the caller
  }
}

/**
 * Wrap an async function with automatic job logging.
 * Usage:
 *   const result = await loggedJob(supabase, 'discover', 'google_search', async () => {
 *     return { success: true, outputCount: 10 };
 *   });
 */
export async function loggedJob<T extends JobResult & { [key: string]: any }>(
  supabase: SupabaseClient,
  jobType: JobType,
  jobName: string,
  fn: () => Promise<T>,
  inputCount = 0
): Promise<T> {
  const logId = await startJobLog(supabase, jobType, jobName, inputCount);
  try {
    const result = await fn();
    await finishJobLog(supabase, logId, result);
    return result;
  } catch (err: any) {
    await finishJobLog(supabase, logId, {
      status: 'error',
      errorMessage: err.message,
      errorCount: 1,
    });
    throw err;
  }
}
