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

export default function CustomerDetailCard({ lead }: Props) {
  const [strategy, setStrategy] = useState<StrategyBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState<'analysis' | 'strategy' | 'email' | 'phone'>('analysis');

  const ai = lead.ai_analysis || {};
  const customs = lead.customs_summary || {};

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
              </div>
            )}
          </div>
        )}

        {activeSection === 'email' && (
          <div>
            <p className="text-xs text-gray-500 mb-3">AI 根据客户特征生成的个性化开发信，可直接复制使用</p>
            {lead.next_recommended_action && (
              <div className="bg-yellow-50 rounded-lg p-3 text-xs text-yellow-800 mb-3">
                当前推荐：{lead.next_recommended_action}
                {lead.next_action_reason && ` — ${lead.next_action_reason}`}
              </div>
            )}
            <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700">
              <p className="text-xs text-gray-400 mb-2">开发信会在 AI 策略生成后自动创建，也可通过开发信引擎自动发送。</p>
              {lead.outreach_status === 'sequence_active' && (
                <p className="text-green-600 text-xs font-medium">开发信序列已启动，系统自动发送中...</p>
              )}
              {lead.outreach_status === 'none' && lead.contact_email && (
                <p className="text-amber-600 text-xs font-medium">有邮箱但尚未进入开发信序列，验证通过后自动启动。</p>
              )}
              {!lead.contact_email && (
                <p className="text-red-500 text-xs">暂无邮箱，无法发送开发信。建议通过 LinkedIn/IG 联系。</p>
              )}
            </div>
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
