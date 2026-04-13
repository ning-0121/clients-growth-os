/**
 * Shared auth helper functions for role checking.
 */
import { getCurrentProfile, requireAuth } from '@/lib/auth';
import { redirect } from 'next/navigation';

/**
 * Require the user to have sales or admin role.
 * Redirects to /login if unauthorized.
 */
export async function requireSalesOrAdmin() {
  await requireAuth();
  const profile = await getCurrentProfile();
  const role = profile?.role || '';

  if (role !== '销售' && role !== '管理员') {
    redirect('/login');
  }

  return { profile, role };
}

/**
 * Validate cron secret from request headers.
 * Returns true if authorized.
 */
export function validateCronAuth(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  return Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
}
