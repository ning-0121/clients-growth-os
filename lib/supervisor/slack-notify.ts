/**
 * Slack incoming webhook — push supervisor alerts to your team channel.
 *
 * Setup (one-time):
 *   1. Go to https://api.slack.com/apps → Create New App → From scratch
 *   2. Features → Incoming Webhooks → Activate → Add New Webhook to Workspace
 *   3. Pick the channel → Copy webhook URL
 *   4. Add to Vercel env vars: SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
 *
 * The webhook URL is the only thing needed — no OAuth, no bot token.
 */

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  fields?: { type: string; text: string }[];
  elements?: any[];
}

interface AlertPayload {
  alert_type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description?: string;
  auto_actions_taken?: string[];
}

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  warning: '🟡',
  info: '🔵',
};

/**
 * Send a Slack notification for a supervisor alert.
 * Silently no-ops if SLACK_WEBHOOK_URL is not set.
 */
export async function notifySlack(alert: AlertPayload): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return; // not configured — silently skip

  const emoji = SEVERITY_EMOJI[alert.severity] || '⚪';
  const ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} Growth OS — ${alert.title}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Severity:*\n${alert.severity.toUpperCase()}` },
        { type: 'mrkdwn', text: `*Type:*\n${alert.alert_type}` },
        { type: 'mrkdwn', text: `*Time (ET):*\n${ts}` },
      ],
    },
  ];

  if (alert.description) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: alert.description },
    });
  }

  if (alert.auto_actions_taken && alert.auto_actions_taken.length > 0) {
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `🤖 Auto-fixed: ${alert.auto_actions_taken.join(', ')}`,
      }],
    });
  }

  // Fallback text for notifications
  const text = `${emoji} [${alert.severity.toUpperCase()}] ${alert.title}`;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, blocks }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err: any) {
    // Don't let Slack failures break the supervisor
    console.warn('[Slack] Notification failed:', err.message);
  }
}

/**
 * Send a daily summary digest (optional — call from a dedicated digest cron).
 */
export async function notifySlackDigest(metrics: {
  new_leads_24h: number;
  emails_sent_24h: number;
  emails_opened_24h: number;
  active_campaigns: number;
  open_rate_pct: number;
}): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📊 Growth OS — Daily Summary', emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*New Leads:*\n${metrics.new_leads_24h}` },
        { type: 'mrkdwn', text: `*Emails Sent:*\n${metrics.emails_sent_24h}` },
        { type: 'mrkdwn', text: `*Emails Opened:*\n${metrics.emails_opened_24h} (${metrics.open_rate_pct}%)` },
        { type: 'mrkdwn', text: `*Active Campaigns:*\n${metrics.active_campaigns}` },
      ],
    },
  ];

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '📊 Growth OS Daily Summary', blocks }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err: any) {
    console.warn('[Slack] Digest failed:', err.message);
  }
}
