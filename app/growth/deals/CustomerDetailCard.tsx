'use client';

import { useState } from 'react';

interface Props {
  lead: any;
}

interface ResearchSummary {
  pages_scanned: number;
  products_found: number;
  has_google_intel: boolean;
  has_linkedin_intel: boolean;
  has_customs_data: boolean;
  price_range: string;
  employee_estimate: string;
}

interface StrategyBundle {
  research_summary?: ResearchSummary | null;
  analysis: {
    company_summary: string;
    strengths: string[];
    risks: string[];
    buying_signals: string[];
    recommended_products: string[];
  };
  strategy: {
    approach: string;
    first_touch_angle: string;
    key_talking_points: string[];
    objection_handling: string[];
    timeline: string;
  };
  phone_script: {
    opening: string;
    introduction: string;
    value_proposition: string;
    questions_to_ask: string[];
    closing: string;
    if_voicemail: string;
  };
}

interface EmailPreview {
  subject: string;
  body_text: string;
  email_quality: string;
  warnings: string[];
  angle_used?: string;
  strategy_used?: { first_touch_angle?: string; approach?: string };
}

export default function CustomerDetailCard({ lead }: Props) {
  const [strategy, setStrategy] = useState<StrategyBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState<'analysis' | 'strategy' | 'email' | 'phone'>('analysis');

  // Email preview state
  const [emailPreview, setEmailPreview] = useState<EmailPreview | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [approvalMsg, setApprovalMsg] = useState('');

  const ai = lead.ai_analysis || {};
  const customs = lead.customs_summary || {};
  const isHighValue = lead.category === 'A' || lead.category === 'B';

  async function loadStrategy() {
    if (strategy) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/ai/customer-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setStrategy(data);
      }
    } catch {
      setError('AI 策略生成失败');
    } finally {
      setLoading(false);
    }
  }

  async function generateEmail() {
    setEmailLoading(true);
    setEmailError('');
    setApprovalMsg('');

    try {
      const res = await fetch('/api/leads/preview-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.id, step_number: 1, email_type: 'intro' }),
      });
      const data = await res.json();

      // Workflow gate: strategy must exist first
      if (res.status === 428 || data.error === 'missing_strategy') {
        setEmailError('');
        setApprovalMsg('');
        // Switch to strategy tab and auto-generate
        setActiveSection('strategy');
        if (!strategy) await loadStrategy();
        return;
      }

      if (data.error) {
        setEmailError(data.error_message || data.error);
      } else {
        setEmailPreview({
          subject: data.email.subject,
          body_text: data.email.body_text,
          email_quality: data.lead.email_quality,
          warnings: data.warnings || [],
          angle_used: data.email.angle_used,
          strategy_used: data.strategy_used,
        });
      }
    } catch {
      setEmailError('AI 邮件生成失败');
    } finally {
      setEmailLoading(false);
    }
  }

  // Check if this lead already has a strategy (avoid calling API to check)
  const hasStrategy = !!(lead.ai_analysis?.outreach_strategy?.strategy?.first_touch_angle) || !!strategy;

  async function submitForApproval() {
    if (!emailPreview) return;
    setSubmitting(true);
    setApprovalMsg('');
    try {
      const res = await fetch('/api/leads/submit-email-approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: lead.id,
          subject: emailPreview.subject,
          body_text: emailPreview.body_text,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setApprovalMsg(`❌ ${data.error}`);
      } else {
        setApprovalMsg('✅ 已提交审批，管理员批准后自动发送');
      }
    } catch {
      setApprovalMsg('❌ 提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  const sections = [
    { id: 'analysis' as const, label: '客户分析' },
    { id: 'strategy' as const, label: '开发策略' },
    { id: 'email' as const, label: '开发信' },
    { id: 'phone' as const, label: '电话话术' },
  ];

  return (
    <div className="border border-indigo-200 rounded-lg mt-1 mb-2 bg-white overflow-hidden">
      {/* Section tabs */}
      <div className="flex border-b border-gray-200 bg-gray-50">
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => { setActiveSection(s.id); loadStrategy(); }}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              activeSection === s.id ? 'border-b-2 border-indigo-600 text-indigo-600 bg-white' : 'text-gray-500'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {/* Basic info always shown */}
        {activeSection === 'analysis' && (
          <div className="space-y-4">
            {/* Quick facts from existing data */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <InfoItem label="公司类型" value={ai.company_type || '未知'} />
              <InfoItem label="公司规模" value={ai.scale_estimate === 'large' ? '大型' : ai.scale_estimate === 'medium' ? '中型' : '小型'} />
              <InfoItem label="产品匹配度" value={ai.product_fit_score ? `${ai.product_fit_score}%` : '未评估'} />
              <InfoItem label="成交概率" value={`${lead.deal_probability || 0}%`} />
            </div>

            {ai.product_categories && ai.product_categories.length > 0 && (
              <div>
                <span className="text-xs text-gray-500">产品品类：</span>
                <span className="text-xs text-gray-700">{ai.product_categories.join(', ')}</span>
              </div>
            )}

            {customs.total_records && (
              <div className="bg-amber-50 rounded-lg p-3 text-xs">
                <div className="font-medium text-amber-800 mb-1">海关数据</div>
                <div className="text-amber-700">
                  进口记录 {customs.total_records} 条 · 总金额 ${customs.total_value_usd?.toLocaleString()} ·
                  {customs.is_apparel_importer ? ' 确认服装进口商' : ' 非服装进口商'}
                </div>
              </div>
            )}

            {/* AI analysis (load on demand) */}
            {!strategy && !loading && (
              <button onClick={loadStrategy} className="w-full py-3 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors font-medium">
                AI 深度调研 + 生成开发策略
              </button>
            )}

            {loading && (
              <div className="text-center py-6">
                <div className="text-sm text-gray-500 mb-2">AI 正在调研这个客户...</div>
                <div className="text-xs text-gray-400 space-y-1">
                  <p>1. 扫描客户网站多个页面（产品、价格、团队）</p>
                  <p>2. Google 搜索公司信息和评价</p>
                  <p>3. LinkedIn 查询公司规模和招聘</p>
                  <p>4. 交叉验证海关贸易数据</p>
                  <p>5. 生成定制化开发策略和话术</p>
                </div>
              </div>
            )}
            {error && <p className="text-sm text-red-600 text-center py-2">{error}</p>}

            {strategy && (
              <div className="space-y-3">
                {/* Research sources badges */}
                {strategy.research_summary && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {strategy.research_summary.pages_scanned > 0 && (
                      <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded">网站扫描 {strategy.research_summary.pages_scanned} 页</span>
                    )}
                    {strategy.research_summary.products_found > 0 && (
                      <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">发现 {strategy.research_summary.products_found} 个产品</span>
                    )}
                    {strategy.research_summary.has_google_intel && (
                      <span className="text-xs bg-orange-50 text-orange-700 px-2 py-0.5 rounded">Google 情报</span>
                    )}
                    {strategy.research_summary.has_linkedin_intel && (
                      <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">LinkedIn 情报</span>
                    )}
                    {strategy.research_summary.has_customs_data && (
                      <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded">海关数据</span>
                    )}
                    {strategy.research_summary.price_range && (
                      <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded">零售价 {strategy.research_summary.price_range}</span>
                    )}
                    {strategy.research_summary.employee_estimate && (
                      <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{strategy.research_summary.employee_estimate}</span>
                    )}
                  </div>
                )}

                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="text-xs font-medium text-blue-800 mb-1">AI 分析摘要</div>
                  <p className="text-sm text-blue-900">{strategy.analysis.company_summary}</p>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-700 mb-1">开发价值</div>
                  <ul className="text-xs text-gray-600 space-y-1">
                    {strategy.analysis.strengths.map((s, i) => <li key={i} className="flex gap-1"><span className="text-green-500">✓</span> {s}</li>)}
                  </ul>
                </div>
                {strategy.analysis.risks.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-gray-700 mb-1">风险提示</div>
                    <ul className="text-xs text-gray-600 space-y-1">
                      {strategy.analysis.risks.map((r, i) => <li key={i} className="flex gap-1"><span className="text-red-500">!</span> {r}</li>)}
                    </ul>
                  </div>
                )}
                {strategy.analysis.recommended_products.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-gray-700 mb-1">推荐产品</div>
                    <div className="flex flex-wrap gap-1">
                      {strategy.analysis.recommended_products.map((p, i) => (
                        <span key={i} className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded">{p}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeSection === 'strategy' && (
          <div>
            {!strategy ? (
              <button onClick={loadStrategy} className="w-full py-3 text-sm text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100">
                {loading ? 'AI 正在制定策略...' : '生成 AI 开发策略'}
              </button>
            ) : (
              <div className="space-y-4">
                <div className="bg-indigo-50 rounded-lg p-3">
                  <div className="text-xs font-medium text-indigo-800 mb-1">开发思路</div>
                  <p className="text-sm text-indigo-900">{strategy.strategy.approach}</p>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-700 mb-1">首次触达切入点</div>
                  <p className="text-sm text-gray-700 bg-gray-50 rounded p-2">{strategy.strategy.first_touch_angle}</p>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-700 mb-1">沟通要点</div>
                  <ul className="text-xs text-gray-600 space-y-1">
                    {strategy.strategy.key_talking_points.map((p, i) => <li key={i}>• {p}</li>)}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-700 mb-1">异议处理</div>
                  <ul className="text-xs text-gray-600 space-y-1">
                    {strategy.strategy.objection_handling.map((o, i) => <li key={i} className="bg-amber-50 rounded p-2">{o}</li>)}
                  </ul>
                </div>
                <div className="text-xs text-gray-500">
                  预期周期：{strategy.strategy.timeline}
                </div>

                {/* Next step → Email tab */}
                <button
                  onClick={() => setActiveSection('email')}
                  className="w-full mt-3 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                >
                  ✓ 策略已生成 · 下一步：撰写开发信 →
                </button>
              </div>
            )}
          </div>
        )}

        {activeSection === 'email' && (
          <div className="space-y-3">
            {/* Contact info status */}
            {!lead.contact_email && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-700 font-medium">❌ 暂无邮箱，无法发送开发信</p>
                <p className="text-xs text-red-600 mt-1">建议通过 LinkedIn/IG 联系，或补充联系方式后再开发</p>
              </div>
            )}

            {lead.contact_email && (
              <>
                <div className="flex items-center justify-between bg-gray-50 rounded p-2">
                  <div className="text-xs">
                    <span className="text-gray-500">收件人：</span>
                    <span className="text-gray-900 font-medium">{lead.contact_name || '(未知)'}</span>
                    <span className="text-gray-500 ml-2">&lt;{lead.contact_email}&gt;</span>
                  </div>
                  {isHighValue && (
                    <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">
                      {lead.category}级 · 需审批
                    </span>
                  )}
                </div>

                {/* Workflow progress indicator */}
                <div className="flex items-center gap-2 text-xs bg-blue-50 border border-blue-100 rounded p-2">
                  <span className="font-medium text-blue-800">开发流程：</span>
                  <WorkflowStep num={1} label="客户分析" done={!!lead.ai_analysis?.is_apparel_company} />
                  <span className="text-blue-400">→</span>
                  <WorkflowStep num={2} label="开发策略" done={hasStrategy} />
                  <span className="text-blue-400">→</span>
                  <WorkflowStep num={3} label="开发信" done={!!emailPreview} />
                  <span className="text-blue-400">→</span>
                  <WorkflowStep num={4} label={isHighValue ? '审批' : '发送'} done={false} />
                </div>

                {/* STRATEGY GATE: must generate strategy first */}
                {!hasStrategy && !emailPreview && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <div className="flex items-start gap-2">
                      <span className="text-amber-500 text-lg">⚠️</span>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-amber-800">需要先生成客户策略</p>
                        <p className="text-xs text-amber-700 mt-1">
                          高质量开发信必须建立在客户分析 + 策略之上。请先在「开发策略」Tab 运行 AI 深度调研，
                          系统会分析客户网站/产品/采购数据，生成专属的开发切入点，然后邮件会基于策略撰写。
                        </p>
                        <button
                          onClick={() => { setActiveSection('strategy'); if (!strategy) loadStrategy(); }}
                          className="mt-3 px-4 py-2 text-xs font-medium text-white bg-amber-600 rounded hover:bg-amber-700"
                        >
                          → 跳转到开发策略 Tab 开始调研
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Strategy summary (shown when strategy exists, before email is generated) */}
                {hasStrategy && !emailPreview && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <span className="text-green-500">✓</span>
                      <div className="flex-1">
                        <p className="text-xs font-medium text-green-800">策略已就绪</p>
                        {(strategy?.strategy?.first_touch_angle || lead.ai_analysis?.outreach_strategy?.strategy?.first_touch_angle) && (
                          <p className="text-xs text-green-700 mt-1">
                            <span className="font-medium">切入角度：</span>
                            {strategy?.strategy?.first_touch_angle || lead.ai_analysis?.outreach_strategy?.strategy?.first_touch_angle}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Generate preview button — only shown if strategy exists */}
                {hasStrategy && !emailPreview && (
                  <button
                    onClick={generateEmail}
                    disabled={emailLoading}
                    className="w-full py-3 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
                  >
                    {emailLoading ? 'AI 基于策略生成邮件中...' : '✨ 基于策略生成 AI 开发信'}
                  </button>
                )}

                {emailError && (
                  <div className="bg-red-50 border border-red-200 rounded p-2">
                    <p className="text-xs text-red-700">{emailError}</p>
                  </div>
                )}

                {/* Preview content */}
                {emailPreview && (
                  <div className="space-y-3">
                    {/* Strategy execution indicator */}
                    {emailPreview.strategy_used?.first_touch_angle && (
                      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-2">
                        <p className="text-xs text-indigo-700">
                          <span className="font-medium">✓ 基于策略：</span>
                          {emailPreview.strategy_used.first_touch_angle}
                        </p>
                        {emailPreview.angle_used && (
                          <p className="text-xs text-indigo-600 mt-1">
                            <span className="font-medium">AI 实际用的切入：</span> {emailPreview.angle_used}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Warnings */}
                    {emailPreview.warnings.length > 0 && (
                      <div className="space-y-1">
                        {emailPreview.warnings.map((w, i) => (
                          <div key={i} className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                            {w}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Subject */}
                    <div className="bg-white border border-indigo-200 rounded-lg overflow-hidden">
                      <div className="bg-indigo-50 px-3 py-2 border-b border-indigo-100">
                        <div className="flex gap-2">
                          <span className="text-xs font-medium text-indigo-700">主题：</span>
                          <span className="text-sm text-gray-900 font-medium flex-1">{emailPreview.subject}</span>
                        </div>
                      </div>
                      <div className="p-3">
                        <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
{emailPreview.body_text}
                        </pre>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={generateEmail}
                        disabled={emailLoading}
                        className="flex-1 py-2 text-xs text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 disabled:opacity-50 font-medium"
                      >
                        {emailLoading ? '重新生成中...' : '🔄 换一版'}
                      </button>
                      {isHighValue ? (
                        <button
                          onClick={submitForApproval}
                          disabled={submitting || emailPreview.email_quality === 'generic'}
                          className="flex-1 py-2 text-xs text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 font-medium"
                        >
                          {submitting ? '提交中...' : '📋 提交审批'}
                        </button>
                      ) : (
                        <button
                          onClick={submitForApproval}
                          disabled={submitting}
                          className="flex-1 py-2 text-xs text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                        >
                          {submitting ? '发送中...' : '📤 加入发送队列'}
                        </button>
                      )}
                    </div>

                    {approvalMsg && (
                      <div className={`text-xs text-center py-2 rounded ${
                        approvalMsg.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                      }`}>
                        {approvalMsg}
                      </div>
                    )}

                    {/* Explanation for A/B */}
                    {isHighValue && (
                      <p className="text-xs text-gray-500 text-center">
                        💡 A/B级高价值客户邮件必须经管理员审批才能发出
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeSection === 'phone' && (
          <div>
            {!strategy ? (
              <button onClick={loadStrategy} className="w-full py-3 text-sm text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100">
                {loading ? 'AI 正在生成话术...' : '生成 AI 电话话术'}
              </button>
            ) : (
              <div className="space-y-3">
                <ScriptSection title="开场白" content={strategy.phone_script.opening} />
                <ScriptSection title="自我介绍" content={strategy.phone_script.introduction} />
                <ScriptSection title="核心价值主张" content={strategy.phone_script.value_proposition} />
                <div>
                  <div className="text-xs font-medium text-gray-700 mb-1">要问客户的问题</div>
                  <ul className="text-xs text-gray-600 space-y-1">
                    {strategy.phone_script.questions_to_ask.map((q, i) => <li key={i}>• {q}</li>)}
                  </ul>
                </div>
                <ScriptSection title="收尾话术" content={strategy.phone_script.closing} />
                <ScriptSection title="如果转语音信箱" content={strategy.phone_script.if_voicemail} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded p-2">
      <div className="text-gray-500">{label}</div>
      <div className="font-medium text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}

function ScriptSection({ title, content }: { title: string; content: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-700 mb-1">{title}</div>
      <div className="bg-gray-50 rounded p-2 text-sm text-gray-700 whitespace-pre-line">{content}</div>
    </div>
  );
}

function WorkflowStep({ num, label, done }: { num: number; label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold ${
        done ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'
      }`}>
        {done ? '✓' : num}
      </span>
      <span className={done ? 'text-green-700 font-medium' : 'text-gray-500'}>{label}</span>
    </div>
  );
}
