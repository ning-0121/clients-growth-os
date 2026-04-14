import { SupabaseClient } from '@supabase/supabase-js';

export interface QueueItem {
  url: string;
  source: string;
  priority?: number;
  data?: Record<string, any>;
}

/**
 * Bulk-enqueue URLs. Deduplicates via UNIQUE(source, target_url).
 */
export async function enqueueUrls(
  items: QueueItem[],
  supabase: SupabaseClient
): Promise<{ queued: number; duplicates: number }> {
  if (items.length === 0) return { queued: 0, duplicates: 0 };

  let queued = 0;
  let duplicates = 0;

  // Insert one by one to handle unique constraint gracefully
  for (const item of items) {
    const { error } = await supabase
      .from('lead_source_queue')
      .insert({
        source: item.source,
        target_url: item.url,
        target_data: item.data || {},
        priority: item.priority || 50,
        status: 'pending',
      });

    if (error) {
      // Unique constraint violation = duplicate, skip silently
      duplicates++;
    } else {
      queued++;
    }
  }

  return { queued, duplicates };
}

/**
 * Dequeue items for processing. Uses optimistic locking:
 * SELECT pending items, then UPDATE to 'processing'.
 */
export async function dequeueItems(
  batchSize: number,
  supabase: SupabaseClient
): Promise<any[]> {
  // Get pending items ordered by priority (low = high priority) then age
  const { data: items } = await supabase
    .from('lead_source_queue')
    .select('*')
    .eq('status', 'pending')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(batchSize);

  if (!items || items.length === 0) return [];

  // Mark as processing (optimistic lock)
  const ids = items.map((i: any) => i.id);
  await supabase
    .from('lead_source_queue')
    .update({ status: 'processing' })
    .in('id', ids)
    .eq('status', 'pending'); // Only update if still pending

  return items;
}

/**
 * Mark a queue item as completed with result data.
 */
export async function markCompleted(
  id: string,
  result: Record<string, any>,
  supabase: SupabaseClient
) {
  await supabase
    .from('lead_source_queue')
    .update({
      status: 'completed',
      result,
      processed_at: new Date().toISOString(),
    })
    .eq('id', id);
}

/**
 * Mark a queue item as failed with error message.
 */
export async function markFailed(
  id: string,
  error: string,
  retryCount: number,
  maxRetries: number,
  supabase: SupabaseClient
) {
  const newRetryCount = retryCount + 1;
  const shouldRetry = newRetryCount < maxRetries;

  await supabase
    .from('lead_source_queue')
    .update({
      status: shouldRetry ? 'pending' : 'failed',
      error_message: error,
      retry_count: newRetryCount,
      // Exponential backoff: 5min, 20min, 60min
      next_retry_at: shouldRetry
        ? new Date(Date.now() + Math.pow(4, newRetryCount) * 5 * 60 * 1000).toISOString()
        : null,
      processed_at: shouldRetry ? null : new Date().toISOString(),
    })
    .eq('id', id);
}

/**
 * Reset stuck items (processing > 30 minutes) back to pending.
 */
export async function resetStuckItems(supabase: SupabaseClient): Promise<number> {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('lead_source_queue')
    .update({ status: 'pending' })
    .eq('status', 'processing')
    .lt('created_at', thirtyMinAgo)
    .select('id');

  return data?.length || 0;
}

/**
 * Retry failed items that are due for retry.
 */
export async function retryFailedItems(supabase: SupabaseClient): Promise<number> {
  const now = new Date().toISOString();

  const { data } = await supabase
    .from('lead_source_queue')
    .update({ status: 'pending' })
    .eq('status', 'failed')
    .lt('next_retry_at', now)
    .not('next_retry_at', 'is', null)
    .select('id');

  return data?.length || 0;
}

/**
 * Get queue statistics.
 */
export async function getQueueStats(supabase: SupabaseClient) {
  const statuses = ['pending', 'processing', 'completed', 'failed', 'skipped'];
  const stats: Record<string, number> = {};

  for (const status of statuses) {
    const { count } = await supabase
      .from('lead_source_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', status);
    stats[status] = count || 0;
  }

  return stats;
}
