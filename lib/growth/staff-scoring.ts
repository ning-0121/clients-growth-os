import { GrowthLead, GrowthLeadAction } from '@/lib/types';

const OUTREACH_TYPES = ['email', 'social_outreach', 'call'];

// Minimum thresholds to produce a meaningful score
const MIN_ASSIGNED_LEADS = 3;
const MIN_ACTIONS = 2;

// ── Types ───────────────────────────────────────────────────

export interface StaffRawMetrics {
  // Context
  activeLeadCount: number;
  assignedInPeriod: number;
  avgLeadGrade: string | null;      // most common grade among active leads

  // Volume
  outreachCount: number;
  firstTouchCount: number;
  followUpCount: number;

  // Discipline
  overdueCount: number;
  overdueRatio: number;
  avgResponseHours: number | null;   // null = no data (no leads with first_touch in period)
  idleCount: number;
  idleRatio: number;

  // Conversion
  replyCount: number;
  promoteCount: number;
  replyRate: number;                 // replies / outreach (0 if no outreach)
}

export interface StaffDimensionScores {
  volume: number;
  discipline: number;
  conversion: number;
}

export type Judgment = '高效执行' | '表现良好' | '需要关注' | '需要干预';

export interface StaffScoreResult {
  userId: string;
  name: string;
  tier: string | null;
  metrics: StaffRawMetrics;
  scores: StaffDimensionScores;
  composite: number;
  judgment: Judgment;
  recommendation: string;
  dataInsufficient: boolean;
}

// ── Scoring functions ───────────────────────────────────────

/**
 * Baseline daily reference targets.
 * Weekly targets = daily * days in period.
 */
function scaleTargets(days: number) {
  return {
    outreach: 8 * days,
    firstTouches: 3 * days,
    followUps: 4 * days,
    replies: 2 * days,
    promotes: 1 * days,
  };
}

export function scoreVolume(metrics: StaffRawMetrics, days: number): number {
  const t = scaleTargets(days);
  const outreachPts = Math.min(metrics.outreachCount / t.outreach, 1) * 50;
  const firstTouchPts = Math.min(metrics.firstTouchCount / t.firstTouches, 1) * 30;
  const followUpPts = Math.min(metrics.followUpCount / t.followUps, 1) * 20;
  return Math.round(outreachPts + firstTouchPts + followUpPts);
}

export function scoreDiscipline(metrics: StaffRawMetrics): number {
  const overduePts = Math.max(0, 1 - metrics.overdueRatio * 2) * 40;

  // Response time: only computed on leads that actually received first touch
  let responsePts: number;
  if (metrics.avgResponseHours === null) {
    responsePts = 20; // neutral — no data, don't penalize
  } else {
    responsePts = Math.max(0, 1 - metrics.avgResponseHours / 8) * 30;
  }

  const idlePts = Math.max(0, 1 - metrics.idleRatio * 3) * 30;
  return Math.round(overduePts + responsePts + idlePts);
}

export function scoreConversion(metrics: StaffRawMetrics, days: number): number {
  const t = scaleTargets(days);
  const replyPts = Math.min(metrics.replyCount / t.replies, 1) * 40;
  const promotePts = Math.min(metrics.promoteCount / t.promotes, 1) * 40;
  const ratePts = Math.min(metrics.replyRate / 0.15, 1) * 20;
  return Math.round(replyPts + promotePts + ratePts);
}

export function computeComposite(scores: StaffDimensionScores): number {
  return Math.round(scores.volume * 0.30 + scores.discipline * 0.35 + scores.conversion * 0.35);
}

export function deriveJudgment(composite: number): Judgment {
  if (composite >= 75) return '高效执行';
  if (composite >= 55) return '表现良好';
  if (composite >= 35) return '需要关注';
  return '需要干预';
}

export function deriveRecommendation(scores: StaffDimensionScores, composite: number): string {
  if (composite >= 75) {
    return '转化优秀，可承接更多高质量线索';
  }
  if (composite >= 55) {
    return '整体表现稳定，继续保持';
  }

  // Find weakest dimension for targeted recommendation
  const { volume, discipline, conversion } = scores;
  const min = Math.min(volume, discipline, conversion);

  if (volume >= 60 && conversion < 25) {
    return '活动多但转化低，检查外联质量';
  }
  if (min === discipline) {
    return '执行纪律差，清理逾期线索';
  }
  if (min === volume) {
    return '行动量不足，需增加每日外联次数';
  }
  return '转化结果偏低，关注回复质量与跟进节奏';
}

// ── Data extraction ─────────────────────────────────────────

/**
 * Compute raw metrics for a single staff member from pre-fetched data.
 */
export function computeMetrics(
  userId: string,
  leads: GrowthLead[],
  actions: GrowthLeadAction[],
  periodStart: string,
  nowIso: string,
): StaffRawMetrics {
  const myLeads = leads.filter((l) => l.assigned_to === userId);
  const activeLeads = myLeads.filter((l) => l.status === 'new' || l.status === 'qualified');
  const myActions = actions.filter((a) => a.created_by === userId);

  // Context: leads assigned during this period
  const assignedInPeriod = myLeads.filter(
    (l) => l.assigned_at && l.assigned_at >= periodStart
  ).length;

  // Most common grade among active leads
  const gradeCounts: Record<string, number> = {};
  activeLeads.forEach((l) => {
    const g = l.grade || 'C';
    gradeCounts[g] = (gradeCounts[g] || 0) + 1;
  });
  const avgLeadGrade = Object.entries(gradeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Volume metrics
  const leadsWithFirstTouch = new Set(leads.filter((l) => l.first_touch_at).map((l) => l.id));
  const outreachActions = myActions.filter((a) => OUTREACH_TYPES.includes(a.action_type));
  const outreachCount = outreachActions.length;
  const firstTouchCount = myLeads.filter(
    (l) => l.first_touch_at && l.first_touch_at >= periodStart && l.assigned_to === userId
  ).length;
  const followUpCount = outreachActions.filter((a) => leadsWithFirstTouch.has(a.lead_id)).length;

  // Discipline: overdue
  const overdueCount = activeLeads.filter(
    (l) => l.next_action_due && l.next_action_due <= nowIso
  ).length;
  const overdueRatio = activeLeads.length > 0 ? overdueCount / activeLeads.length : 0;

  // Discipline: avg response time (only on leads assigned in period that received first_touch)
  const touchedNewLeads = myLeads.filter(
    (l) => l.assigned_at && l.assigned_at >= periodStart && l.first_touch_at
  );
  let avgResponseHours: number | null = null;
  if (touchedNewLeads.length > 0) {
    const totalHours = touchedNewLeads.reduce((sum, l) => {
      const assigned = new Date(l.assigned_at!).getTime();
      const touched = new Date(l.first_touch_at!).getTime();
      return sum + Math.max(0, (touched - assigned) / (1000 * 60 * 60));
    }, 0);
    avgResponseHours = totalHours / touchedNewLeads.length;
  }

  // Discipline: idle leads (assigned >24h ago, 0 actions, still active)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const idleCount = activeLeads.filter(
    (l) => l.assigned_at && l.assigned_at < oneDayAgo && l.action_count === 0
  ).length;
  const idleRatio = activeLeads.length > 0 ? idleCount / activeLeads.length : 0;

  // Conversion
  const replyCount = myActions.filter((a) => a.action_type === 'reply').length;
  const promoteCount = myActions.filter((a) => a.action_type === 'promote').length;
  const replyRate = outreachCount > 0 ? replyCount / outreachCount : 0;

  return {
    activeLeadCount: activeLeads.length,
    assignedInPeriod,
    avgLeadGrade,
    outreachCount,
    firstTouchCount,
    followUpCount,
    overdueCount,
    overdueRatio,
    avgResponseHours,
    idleCount,
    idleRatio,
    replyCount,
    promoteCount,
    replyRate,
  };
}

/**
 * Full scoring pipeline for one staff member.
 */
export function scoreStaff(
  userId: string,
  name: string,
  tier: string | null,
  leads: GrowthLead[],
  actions: GrowthLeadAction[],
  periodStart: string,
  nowIso: string,
  days: number,
): StaffScoreResult {
  const metrics = computeMetrics(userId, leads, actions, periodStart, nowIso);

  // Data insufficient check
  const dataInsufficient = metrics.activeLeadCount < MIN_ASSIGNED_LEADS
    && metrics.outreachCount < MIN_ACTIONS;

  const scores: StaffDimensionScores = dataInsufficient
    ? { volume: 0, discipline: 0, conversion: 0 }
    : {
        volume: scoreVolume(metrics, days),
        discipline: scoreDiscipline(metrics),
        conversion: scoreConversion(metrics, days),
      };

  const composite = dataInsufficient ? 0 : computeComposite(scores);
  const judgment: Judgment = dataInsufficient ? '需要关注' : deriveJudgment(composite);
  const recommendation = dataInsufficient
    ? '数据不足，无法评估（线索或操作数量过少）'
    : deriveRecommendation(scores, composite);

  return {
    userId,
    name,
    tier,
    metrics,
    scores,
    composite,
    judgment,
    recommendation,
    dataInsufficient,
  };
}
