import { Market, SeasonCode, SeasonalTaskType } from '@/lib/types';

// ── Market × Season Default Timelines ──
//
// KEY INSIGHT: Retailers put products on shelf 2-3 months BEFORE the natural season.
// Summer clothes appear in April, Fall clothes in July (Back-to-School), Winter in September.
//
// Sources: AIMS360 Fashion Wholesale Calendar, Target Seasonal Retail Guide
//
// Offset days are counted BACKWARDS from shelf_month_start day 1.

export interface SeasonConfig {
  label: string;
  labelCn: string;
  shelfMonthStart: number; // 1-12, when product first appears on shelf
  shelfMonthEnd: number;   // 1-12, when season winds down
  // Default offset days before shelf start
  prepOffsetDays: number;         // Product prep (samples, lookbooks)
  bookMeetingOffsetDays: number;  // Book the meeting appointment
  meetingOffsetDays: number;      // Actual buyer meeting
  orderOffsetDays: number;        // Order placed / production starts
  shipOffsetDays: number;         // Ship from China
}

export const MARKET_SEASONS: Record<Market, Record<SeasonCode, SeasonConfig>> = {
  // ── US Retailers (Ross, TJMaxx, Walmart, Target) ──
  us: {
    SS1: {
      label: 'Early Spring', labelCn: '早春',
      shelfMonthStart: 1, shelfMonthEnd: 2,
      prepOffsetDays: 180, bookMeetingOffsetDays: 180,
      meetingOffsetDays: 150, orderOffsetDays: 140,
      shipOffsetDays: 60,
    },
    SS2: {
      label: 'Spring/Summer', labelCn: '春夏',
      shelfMonthStart: 3, shelfMonthEnd: 5,
      prepOffsetDays: 180, bookMeetingOffsetDays: 180,
      meetingOffsetDays: 150, orderOffsetDays: 140,
      shipOffsetDays: 60,
    },
    FW1: {
      label: 'Fall / Back-to-School', labelCn: '秋季/返校',
      shelfMonthStart: 7, shelfMonthEnd: 8,
      prepOffsetDays: 180, bookMeetingOffsetDays: 180,
      meetingOffsetDays: 150, orderOffsetDays: 140,
      shipOffsetDays: 60,
    },
    FW2: {
      label: 'Holiday/Winter', labelCn: '冬季/节日',
      shelfMonthStart: 9, shelfMonthEnd: 10,
      prepOffsetDays: 180, bookMeetingOffsetDays: 180,
      meetingOffsetDays: 150, orderOffsetDays: 140,
      shipOffsetDays: 60,
    },
  },

  // ── European Market (shifted ~1 month later than US) ──
  eu: {
    SS1: {
      label: 'Early Spring', labelCn: '早春',
      shelfMonthStart: 2, shelfMonthEnd: 3,
      prepOffsetDays: 180, bookMeetingOffsetDays: 180,
      meetingOffsetDays: 150, orderOffsetDays: 140,
      shipOffsetDays: 70, // slightly longer shipping to EU
    },
    SS2: {
      label: 'Spring/Summer', labelCn: '春夏',
      shelfMonthStart: 4, shelfMonthEnd: 6,
      prepOffsetDays: 180, bookMeetingOffsetDays: 180,
      meetingOffsetDays: 150, orderOffsetDays: 140,
      shipOffsetDays: 70,
    },
    FW1: {
      label: 'Autumn', labelCn: '秋季',
      shelfMonthStart: 8, shelfMonthEnd: 9,
      prepOffsetDays: 180, bookMeetingOffsetDays: 180,
      meetingOffsetDays: 150, orderOffsetDays: 140,
      shipOffsetDays: 70,
    },
    FW2: {
      label: 'Winter', labelCn: '冬季',
      shelfMonthStart: 10, shelfMonthEnd: 11,
      prepOffsetDays: 180, bookMeetingOffsetDays: 180,
      meetingOffsetDays: 150, orderOffsetDays: 140,
      shipOffsetDays: 70,
    },
  },

  // ── Japanese Market (structured, SS and FW) ──
  jp: {
    SS1: {
      label: 'SS Early', labelCn: '春夏前期',
      shelfMonthStart: 2, shelfMonthEnd: 3,
      prepOffsetDays: 150, bookMeetingOffsetDays: 150,
      meetingOffsetDays: 120, orderOffsetDays: 120,
      shipOffsetDays: 45, // shorter shipping to JP
    },
    SS2: {
      label: 'SS Main', labelCn: '春夏主季',
      shelfMonthStart: 4, shelfMonthEnd: 5,
      prepOffsetDays: 150, bookMeetingOffsetDays: 150,
      meetingOffsetDays: 120, orderOffsetDays: 120,
      shipOffsetDays: 45,
    },
    FW1: {
      label: 'FW Early', labelCn: '秋冬前期',
      shelfMonthStart: 8, shelfMonthEnd: 9,
      prepOffsetDays: 150, bookMeetingOffsetDays: 150,
      meetingOffsetDays: 120, orderOffsetDays: 120,
      shipOffsetDays: 45,
    },
    FW2: {
      label: 'FW Main', labelCn: '秋冬主季',
      shelfMonthStart: 10, shelfMonthEnd: 11,
      prepOffsetDays: 150, bookMeetingOffsetDays: 150,
      meetingOffsetDays: 120, orderOffsetDays: 120,
      shipOffsetDays: 45,
    },
  },

  // ── Other Markets (use US timing as baseline) ──
  other: {
    SS1: {
      label: 'Early Spring', labelCn: '早春',
      shelfMonthStart: 2, shelfMonthEnd: 3,
      prepOffsetDays: 180, bookMeetingOffsetDays: 180,
      meetingOffsetDays: 150, orderOffsetDays: 140,
      shipOffsetDays: 60,
    },
    SS2: {
      label: 'Spring/Summer', labelCn: '春夏',
      shelfMonthStart: 4, shelfMonthEnd: 6,
      prepOffsetDays: 180, bookMeetingOffsetDays: 180,
      meetingOffsetDays: 150, orderOffsetDays: 140,
      shipOffsetDays: 60,
    },
    FW1: {
      label: 'Fall', labelCn: '秋季',
      shelfMonthStart: 8, shelfMonthEnd: 9,
      prepOffsetDays: 180, bookMeetingOffsetDays: 180,
      meetingOffsetDays: 150, orderOffsetDays: 140,
      shipOffsetDays: 60,
    },
    FW2: {
      label: 'Winter', labelCn: '冬季',
      shelfMonthStart: 10, shelfMonthEnd: 11,
      prepOffsetDays: 180, bookMeetingOffsetDays: 180,
      meetingOffsetDays: 150, orderOffsetDays: 140,
      shipOffsetDays: 60,
    },
  },
};

// ── Task Type Labels & Colors ──

export const TASK_TYPE_CONFIG: Record<SeasonalTaskType, {
  label: string;
  labelCn: string;
  color: string;
  bgColor: string;
  seq: number; // ordering within a season timeline
}> = {
  product_prep:     { label: 'Product Prep',    labelCn: '产品准备',  color: 'text-purple-700', bgColor: 'bg-purple-100', seq: 1 },
  book_meeting:     { label: 'Book Meeting',    labelCn: '预约会议',  color: 'text-blue-700',   bgColor: 'bg-blue-100',   seq: 2 },
  meeting:          { label: 'Buyer Meeting',   labelCn: '买家会议',  color: 'text-indigo-700', bgColor: 'bg-indigo-100', seq: 3 },
  submit_order:     { label: 'Submit Order',    labelCn: '下单',     color: 'text-amber-700',  bgColor: 'bg-amber-100',  seq: 4 },
  production_start: { label: 'Production',      labelCn: '生产开始',  color: 'text-orange-700', bgColor: 'bg-orange-100', seq: 5 },
  ship:             { label: 'Ship',            labelCn: '发货',     color: 'text-green-700',  bgColor: 'bg-green-100',  seq: 6 },
};

export const SEASON_COLORS: Record<SeasonCode, { color: string; bgColor: string }> = {
  SS1: { color: 'text-emerald-700', bgColor: 'bg-emerald-100' },
  SS2: { color: 'text-yellow-700',  bgColor: 'bg-yellow-100' },
  FW1: { color: 'text-orange-700',  bgColor: 'bg-orange-100' },
  FW2: { color: 'text-blue-700',    bgColor: 'bg-blue-100' },
};

export const MARKET_LABELS: Record<Market, { label: string; labelCn: string }> = {
  us:    { label: 'United States', labelCn: '美国' },
  eu:    { label: 'Europe',        labelCn: '欧洲' },
  jp:    { label: 'Japan',         labelCn: '日本' },
  other: { label: 'Other',         labelCn: '其他' },
};

// ── Deadline Calculation ──

export interface SeasonDeadlines {
  season: SeasonCode;
  targetYear: number;
  shelfStart: Date;
  shelfEnd: Date;
  productPrep: Date;
  bookMeeting: Date;
  meeting: Date;
  submitOrder: Date;
  productionStart: Date;
  ship: Date;
}

interface OffsetOverrides {
  shelfMonthStart?: number | null;
  customPrepOffset?: number | null;
  customMeetingOffset?: number | null;
  customOrderOffset?: number | null;
}

/**
 * Calculate all deadline dates for a given market/season/year.
 * Counts backwards from shelf start date using offset days.
 *
 * Supports per-customer overrides for shelf month and offsets.
 */
export function calculateDeadlines(
  market: Market,
  season: SeasonCode,
  targetYear: number,
  overrides?: OffsetOverrides
): SeasonDeadlines {
  const config = MARKET_SEASONS[market][season];

  const shelfStart = overrides?.shelfMonthStart ?? config.shelfMonthStart;
  const shelfEnd = config.shelfMonthEnd;

  // Shelf start: 1st of the shelf month in target year
  // Special handling: if shelf month would be in previous year (e.g., SS1 Jan for year 2027)
  // the deadlines should reference the correct year
  const shelfStartDate = new Date(targetYear, shelfStart - 1, 1);

  // Shelf end: last day of shelf end month
  // Handle cross-year (e.g., FW2 ending in Jan of next year)
  const endYear = shelfEnd < shelfStart ? targetYear + 1 : targetYear;
  const shelfEndDate = new Date(endYear, shelfEnd, 0); // day 0 = last day of previous month

  // Apply offsets (custom overrides take precedence)
  const prepDays = overrides?.customPrepOffset ?? config.prepOffsetDays;
  const meetingDays = overrides?.customMeetingOffset ?? config.meetingOffsetDays;
  const orderDays = overrides?.customOrderOffset ?? config.orderOffsetDays;

  return {
    season,
    targetYear,
    shelfStart: shelfStartDate,
    shelfEnd: shelfEndDate,
    productPrep: subtractDays(shelfStartDate, prepDays),
    bookMeeting: subtractDays(shelfStartDate, config.bookMeetingOffsetDays),
    meeting: subtractDays(shelfStartDate, meetingDays),
    submitOrder: subtractDays(shelfStartDate, orderDays),
    productionStart: subtractDays(shelfStartDate, orderDays), // same as order
    ship: subtractDays(shelfStartDate, config.shipOffsetDays),
  };
}

function subtractDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
}

/**
 * Convert deadlines into task type → due date pairs for insertion.
 */
export function deadlinesToTasks(
  deadlines: SeasonDeadlines
): { taskType: SeasonalTaskType; dueDate: string }[] {
  return [
    { taskType: 'product_prep',     dueDate: formatDate(deadlines.productPrep) },
    { taskType: 'book_meeting',     dueDate: formatDate(deadlines.bookMeeting) },
    { taskType: 'meeting',          dueDate: formatDate(deadlines.meeting) },
    { taskType: 'submit_order',     dueDate: formatDate(deadlines.submitOrder) },
    { taskType: 'production_start', dueDate: formatDate(deadlines.productionStart) },
    { taskType: 'ship',             dueDate: formatDate(deadlines.ship) },
  ];
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Determine which season a target shelf month belongs to for a given market.
 */
export function getSeasonForMonth(market: Market, month: number): SeasonCode | null {
  const seasons = MARKET_SEASONS[market];
  for (const [code, config] of Object.entries(seasons)) {
    if (config.shelfMonthStart <= config.shelfMonthEnd) {
      if (month >= config.shelfMonthStart && month <= config.shelfMonthEnd) {
        return code as SeasonCode;
      }
    } else {
      // Cross-year (e.g., Nov-Jan)
      if (month >= config.shelfMonthStart || month <= config.shelfMonthEnd) {
        return code as SeasonCode;
      }
    }
  }
  return null;
}

/**
 * Get all upcoming seasons (with deadlines) for the next N months from now.
 * Useful for the dashboard "what to do this month" view.
 */
export function getUpcomingDeadlines(
  market: Market,
  fromDate: Date,
  monthsAhead = 6
): SeasonDeadlines[] {
  const results: SeasonDeadlines[] = [];
  const seasons: SeasonCode[] = ['SS1', 'SS2', 'FW1', 'FW2'];
  const cutoff = new Date(fromDate);
  cutoff.setMonth(cutoff.getMonth() + monthsAhead);

  // Check current year and next year
  for (const year of [fromDate.getFullYear(), fromDate.getFullYear() + 1]) {
    for (const season of seasons) {
      const deadlines = calculateDeadlines(market, season, year);
      // Include if any deadline falls within our window
      const earliestDeadline = deadlines.productPrep;
      const latestDeadline = deadlines.ship;

      if (latestDeadline >= fromDate && earliestDeadline <= cutoff) {
        results.push(deadlines);
      }
    }
  }

  return results.sort((a, b) => a.shelfStart.getTime() - b.shelfStart.getTime());
}
