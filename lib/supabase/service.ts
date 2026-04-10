import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client for background/cron operations.
 * Bypasses RLS — use only in server-side API routes and cron jobs, never in user-facing code.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Add SUPABASE_SERVICE_ROLE_KEY to .env.local (find it in Supabase Dashboard → Settings → API → service_role key).'
    );
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
