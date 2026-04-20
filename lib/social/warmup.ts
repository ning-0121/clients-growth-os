/**
 * PhantomBuster warm-up caps.
 *
 * New IG / LinkedIn automation accounts get flagged fast if you hit normal
 * volume on day 1. We ramp linearly from 20% → 100% of normal caps over
 * 14 days, so the account builds a trust profile before running at speed.
 *
 * Activation: set `PHANTOMBUSTER_WARMUP_START_DATE=YYYY-MM-DD` on Vercel
 * (the date you first attached the session cookie to the phantom).
 * If unset, no warm-up is applied — existing accounts run at full speed.
 */

const NORMAL_DAILY_CAPS = {
  ig_comments: 10,
  ig_dms: 15,
  linkedin_connects: 20,
};
const WARMUP_DAYS = 14;
const START_MULTIPLIER = 0.2;

export interface WarmupCaps {
  ig_comments: number;
  ig_dms: number;
  linkedin_connects: number;
  multiplier: number;
  is_warming_up: boolean;
  days_remaining: number;
  start_date: string | null;
}

function buildCaps(multiplier: number, daysRemaining: number, startDate: string | null): WarmupCaps {
  return {
    ig_comments: Math.max(1, Math.floor(NORMAL_DAILY_CAPS.ig_comments * multiplier)),
    ig_dms: Math.max(1, Math.floor(NORMAL_DAILY_CAPS.ig_dms * multiplier)),
    linkedin_connects: Math.max(1, Math.floor(NORMAL_DAILY_CAPS.linkedin_connects * multiplier)),
    multiplier,
    is_warming_up: multiplier < 1.0,
    days_remaining: daysRemaining,
    start_date: startDate,
  };
}

export function getWarmupCaps(): WarmupCaps {
  const startStr = process.env.PHANTOMBUSTER_WARMUP_START_DATE;
  if (!startStr) {
    return buildCaps(1.0, 0, null);
  }

  const start = new Date(startStr);
  if (Number.isNaN(start.getTime())) {
    return buildCaps(1.0, 0, null);
  }

  const now = new Date();
  const daysSince = Math.floor((now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));

  // Start date in future → use minimum (edge case, e.g. user pre-scheduled)
  if (daysSince < 0) return buildCaps(START_MULTIPLIER, WARMUP_DAYS, startStr);

  // Fully warmed up
  if (daysSince >= WARMUP_DAYS) return buildCaps(1.0, 0, startStr);

  // Linear ramp: 0.2 at day 0 → 1.0 at day 14
  const multiplier = START_MULTIPLIER + (1.0 - START_MULTIPLIER) * (daysSince / WARMUP_DAYS);
  return buildCaps(multiplier, WARMUP_DAYS - daysSince, startStr);
}
