'use client';

import { useState } from 'react';
import { pauseCampaign, resumeCampaign } from '@/app/actions/outreach';

// ── Types ────────────────────────────────────────────────────────────────────

interface EmailRecord {
  id: string;
  step_number: number;
  subject: string;
  body_text: string;
  body_html: string;
  to_email: string;
  status: string;
  sent_at: string | null;
  opened_at: string | null;
}

interface Campaign {
  id: string;
  lead_id: string;
  current_step: number;
  status: string;
  next_send_at: string | null;
  enrolled_at: string | null;
  growth_leads: {
    company_name: string;
    contact_name: string | null;
    contact_email: string | null;
    grade: string | null;
    website: string | null;
  };
  outreach_sequences: {
    name: string;
    steps: { step_number: number; delay_days: number; email_type: string }[];
  };
  outreach_emails: EmailRecord[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  active:       { label: '进行中', color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  paused:       { label: '已暂停', color: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-500' },
  completed:    { label: '已完成', color: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
  replied:      { label: '已回复 ✓', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  bounced:      { label: '退信', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  unsubscribed: { label: '退订', color: 'bg-red-50 text-red-600', dot: 'bg-red-400' },
};

const EMAIL_STATUS_COLOR: Record<string, string> = {
  sent:      'text-blue-600',
  delivered: 'text-green-600',
  opened:    'text-emerald-600 font-semibold',
  bounced:   'text-red-600',
  failed:    'text-red-500',
};

const GENERIC_PREFIXES = ['info', 'hello', 'contact', 'sales', 'support', 'help', 'admin', 'office', 'mail', 'team'];

function isGenericEmail(email: string | null) {
  if (!email) return false;
  const local = email.split('@')[0].toLowerCase();
  return GENERIC_PREFIXES.some(p => local === p || local.startsWith(p + '.'));
}

// ── EmailPreviewPanel ─────────────────────────────────────────────────────────

function EmailPreviewPanel({ leadId, leadName }: { leadId: string; leadName: string }) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; body_text: string; warnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/leads/preview-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId, step_number: 1, email_type: 'intro' }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setPreview({ subject: data.email.subject, body_text: data.email.body_text, warnings: data.warnings || [] });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-indigo-700">AI 邮件预览（第1封）</span>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? '生成中...' : preview ? '重新生成' : '生成预览'}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {preview && (
        <div className="space-y-2">
          {preview.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded">{w}</p>
          ))}
          <div>
            <span className="text-xs font-medium text-gray-600">主题：</span>
            <span className="text-xs text-gray-900 ml-1">{preview.subject}</span>
          </div>
          <div className="bg-white rounded p-2 border border-indigo-200">
            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{preview.body_text}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CampaignRow ───────────────────────────────────────────────────────────────

function CampaignRow({ campaign }: { campaign: Campaign }) {
  const [expanded, setExpanded] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const lead = campaign.growth_leads;
  const sequence = campaign.outreach_sequences;
  const steps = sequence?.steps || [];
  const emails = campaign.outreach_emails || [];
  const badge = STATUS_CONFIG[campaign.status] || { label: campaign.status, color: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' };
  const emailIsGeneric = isGenericEmail(lead?.contact_email);

  async function handlePause() {
    setLoadingAction(true);
    await pauseCampaign(campaign.id);
    setLoadingAction(false);
  }

  async function handleResume() {
    setLoadingAction(true);
    await resumeCampaign(campaign.id);
    setLoadingAction(false);
  }

  return (
    <div className="border-b last:border-b-0">
      {/* Main row */}
      <div
        className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Expand arrow */}
        <span className="text-gray-400 text-xs w-3">{expanded ? '▼' : '▶'}</span>

        {/* Status */}
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${badge.color}`}>
          {badge.label}
        </span>

        {/* Lead info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900 truncate">{lead?.company_name || '未知'}</span>
            {lead?.grade && (
              <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${
                lead.grade === 'A' ? 'bg-green-100 text-green-700' :
                lead.grade === 'B' ? 'bg-blue-100 text-blue-700' :
                lead.grade === 'C' ? 'bg-yellow-100 text-yellow-700' :
                'bg-gray-100 text-gray-500'
              }`}>{lead.grade}</span>
            )}
            {emailIsGeneric && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600" title="泛型邮件地址，发送后可能无人处理">
                ⚠️ 泛型邮箱
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 truncate mt-0.5">
            {lead?.contact_name ? `${lead.contact_name} · ` : ''}{lead?.contact_email || '无邮箱'}
            {sequence?.name ? ` · ${sequence.name}` : ''}
            {` · Step ${campaign.current_step}/${steps.length}`}
          </div>
        </div>

        {/* Email count */}
        <div className="text-xs text-gray-400 whitespace-nowrap hidden sm:block">
          {emails.length} 封记录
        </div>

        {/* Next send */}
        {campaign.status === 'active' && campaign.next_send_at && (
          <span className="text-xs text-gray-400 whitespace-nowrap hidden md:block">
            下次: {new Date(campaign.next_send_at).toLocaleDateString('zh-CN', {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </span>
        )}

        {/* Action buttons */}
        <div className="flex gap-1.5 ml-auto" onClick={e => e.stopPropagation()}>
          {campaign.status === 'active' && (
            <button
              onClick={handlePause}
              disabled={loadingAction}
              className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-yellow-100 text-gray-600 hover:text-yellow-700"
            >
              {loadingAction ? '...' : '暂停'}
            </button>
          )}
          {campaign.status === 'paused' && (
            <button
              onClick={handleResume}
              disabled={loadingAction}
              className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-green-100 text-gray-600 hover:text-green-700"
            >
              {loadingAction ? '...' : '恢复'}
            </button>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-10 pb-4 space-y-3">
          {/* Email quality warning */}
          {emailIsGeneric && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200">
              <p className="text-xs text-red-700 font-medium">
                ⚠️ 联系方式问题：<code className="bg-red-100 px-1 rounded">{lead?.contact_email}</code> 是泛型邮箱
              </p>
              <p className="text-xs text-red-600 mt-1">
                这类邮件通常发给客服、前台或直接被过滤。需要找到具体负责人的个人邮箱再发。
                <br />建议：去 LinkedIn 找公司 Buying Manager / Sourcing Director，或用 Hunter.io 搜索个人邮箱。
              </p>
            </div>
          )}

          {/* Sent emails history */}
          {emails.length > 0 ? (
            <div>
              <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">邮件历史</h4>
              <div className="space-y-2">
                {emails.map((email) => (
                  <EmailHistoryCard key={email.id} email={email} />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400">尚无发送记录</p>
          )}

          {/* Preview next email */}
          {lead && (
            <div>
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="text-xs text-indigo-600 hover:text-indigo-800 underline"
              >
                {showPreview ? '隐藏预览' : '👁 预览下一封 AI 邮件'}
              </button>
              {showPreview && (
                <EmailPreviewPanel leadId={campaign.lead_id} leadName={lead.company_name} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── EmailHistoryCard ──────────────────────────────────────────────────────────

function EmailHistoryCard({ email }: { email: EmailRecord }) {
  const [showBody, setShowBody] = useState(false);
  const statusColor = EMAIL_STATUS_COLOR[email.status] || 'text-gray-500';

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-500">Step {email.step_number}</span>
            <span className={`text-xs font-medium ${statusColor}`}>
              {email.status === 'sent' ? '已发送' :
               email.status === 'delivered' ? '已送达' :
               email.status === 'opened' ? '已打开 👁' :
               email.status === 'bounced' ? '退信 ✗' :
               email.status}
            </span>
            {email.sent_at && (
              <span className="text-xs text-gray-400">
                {new Date(email.sent_at).toLocaleDateString('zh-CN', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            )}
            {email.opened_at && (
              <span className="text-xs text-emerald-600">
                打开于 {new Date(email.opened_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
          <div className="mt-1">
            <span className="text-xs text-gray-500">主题：</span>
            <span className="text-xs text-gray-900">{email.subject}</span>
          </div>
        </div>
        <button
          onClick={() => setShowBody(!showBody)}
          className="text-xs text-indigo-500 hover:text-indigo-700 whitespace-nowrap"
        >
          {showBody ? '收起' : '查看内容'}
        </button>
      </div>

      {showBody && (
        <div className="mt-2 p-2 bg-gray-50 rounded border border-gray-100">
          <p className="text-xs text-gray-400 mb-1">收件人: {email.to_email}</p>
          <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
            {email.body_text}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function OutreachDashboard({ campaigns }: { campaigns: Campaign[] }) {
  const [filter, setFilter] = useState<string>('all');

  const counts = {
    all: campaigns.length,
    active: campaigns.filter(c => c.status === 'active').length,
    replied: campaigns.filter(c => c.status === 'replied').length,
    paused: campaigns.filter(c => c.status === 'paused').length,
    bounced: campaigns.filter(c => c.status === 'bounced').length,
    completed: campaigns.filter(c => c.status === 'completed').length,
  };

  // Flag campaigns with generic emails
  const genericEmailCampaigns = campaigns.filter(c => isGenericEmail(c.growth_leads?.contact_email));

  const filtered = filter === 'all' ? campaigns : campaigns.filter(c => c.status === filter);

  return (
    <div className="space-y-4">
      {/* Generic email warning banner */}
      {genericEmailCampaigns.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <span className="text-amber-500 text-lg">⚠️</span>
            <div>
              <p className="text-sm font-semibold text-amber-800">
                {genericEmailCampaigns.length} 个客户使用了泛型邮箱
              </p>
              <p className="text-xs text-amber-700 mt-1">
                发到 info@、sales@、contact@ 等地址的邮件通常无人回复，或直接被过滤。
                建议先找到真实负责人再发。
              </p>
              <p className="text-xs text-amber-600 mt-1">
                涉及：{genericEmailCampaigns.slice(0, 5).map(c => c.growth_leads?.company_name).join('、')}
                {genericEmailCampaigns.length > 5 ? ` 等 ${genericEmailCampaigns.length} 个` : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Campaign list */}
      <div className="bg-white rounded-lg border border-gray-200">
        {/* Filter tabs */}
        <div className="flex gap-2 px-4 py-3 border-b overflow-x-auto">
          {(['all', 'active', 'replied', 'paused', 'bounced', 'completed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                filter === f
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
              }`}
            >
              {f === 'all' ? '全部' :
               f === 'active' ? '进行中' :
               f === 'replied' ? '已回复' :
               f === 'paused' ? '已暂停' :
               f === 'bounced' ? '退信' :
               '已完成'}
              <span className="ml-1 text-gray-400">{counts[f]}</span>
            </button>
          ))}
        </div>

        {/* Campaigns */}
        <div className="divide-y">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-gray-400">暂无数据</p>
              <p className="text-xs text-gray-400 mt-1">
                当线索通过验证（个人邮箱 + 评分≥60）后，会自动加入邮件序列
              </p>
            </div>
          ) : (
            filtered.map((campaign) => (
              <CampaignRow key={campaign.id} campaign={campaign} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
