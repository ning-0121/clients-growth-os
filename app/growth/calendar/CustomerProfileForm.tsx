'use client';

import { useState } from 'react';
import { createCustomerProfile, upsertSeasonalConfig, generateSeasonalTasks } from '@/app/actions/seasonal-calendar';
import { MARKET_SEASONS, MARKET_LABELS, SEASON_COLORS } from '@/lib/growth/seasonal-calendar';
import { Market, CustomerType, SeasonCode } from '@/lib/types';

interface Props {
  customers: any[];
  configs: any[];
}

const MARKETS: Market[] = ['us', 'eu', 'jp', 'other'];
const CUSTOMER_TYPES: { value: CustomerType; label: string }[] = [
  { value: 'retailer', label: '零售商 (Retailer)' },
  { value: 'brand', label: '品牌商 (Brand)' },
  { value: 'distributor', label: '分销商 (Distributor)' },
  { value: 'other', label: '其他' },
];
const SEASONS: SeasonCode[] = ['SS1', 'SS2', 'FW1', 'FW2'];

export default function CustomerProfileForm({ customers, configs }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'profile' | 'seasons' | 'done'>('profile');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [market, setMarket] = useState<Market>('us');
  const [customerType, setCustomerType] = useState<CustomerType>('retailer');
  const [productPrefs, setProductPrefs] = useState('');
  const [notes, setNotes] = useState('');

  // Season toggles
  const [activeSeasons, setActiveSeasons] = useState<Record<SeasonCode, boolean>>({
    SS1: false, SS2: false, FW1: true, FW2: true,
  });
  const [seasonCategories, setSeasonCategories] = useState<Record<SeasonCode, string>>({
    SS1: '', SS2: '', FW1: '', FW2: '',
  });

  function reset() {
    setStep('profile');
    setName('');
    setMarket('us');
    setCustomerType('retailer');
    setProductPrefs('');
    setNotes('');
    setActiveSeasons({ SS1: false, SS2: false, FW1: true, FW2: true });
    setSeasonCategories({ SS1: '', SS2: '', FW1: '', FW2: '' });
    setError('');
    setCreatedId(null);
  }

  async function handleCreateProfile() {
    if (!name.trim()) { setError('请输入客户名称'); return; }
    setLoading(true);
    setError('');

    const result = await createCustomerProfile({
      customer_name: name.trim(),
      market,
      customer_type: customerType,
      product_preferences: productPrefs || undefined,
      notes: notes || undefined,
    });

    setLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    setCreatedId(result.profile?.id || null);
    setStep('seasons');
  }

  async function handleSaveSeasons() {
    if (!createdId) return;
    setLoading(true);
    setError('');

    // Save each season config
    for (const season of SEASONS) {
      await upsertSeasonalConfig(createdId, season, {
        is_active: activeSeasons[season],
        product_categories: seasonCategories[season] || null,
      });
    }

    // Generate tasks for current and next year
    const currentYear = new Date().getFullYear();
    await generateSeasonalTasks(createdId, currentYear);
    await generateSeasonalTasks(createdId, currentYear + 1);

    setLoading(false);
    setStep('done');
  }

  if (!open) {
    return (
      <button
        onClick={() => { reset(); setOpen(true); }}
        className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
      >
        + 新建客户
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {step === 'profile' && '新建客户档案'}
            {step === 'seasons' && '配置采购季节'}
            {step === 'done' && '完成'}
          </h2>
          <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
          )}

          {step === 'profile' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">客户名称 *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ross Stores"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">市场</label>
                  <select
                    value={market}
                    onChange={(e) => setMarket(e.target.value as Market)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    {MARKETS.map((m) => (
                      <option key={m} value={m}>{MARKET_LABELS[m].labelCn} ({MARKET_LABELS[m].label})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">客户类型</label>
                  <select
                    value={customerType}
                    onChange={(e) => setCustomerType(e.target.value as CustomerType)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    {CUSTOMER_TYPES.map((ct) => (
                      <option key={ct.value} value={ct.value}>{ct.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">偏好品类</label>
                <input
                  type="text"
                  value={productPrefs}
                  onChange={(e) => setProductPrefs(e.target.value)}
                  placeholder="e.g. activewear, compression, yoga"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="采购联系人、特殊要求等"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <button
                onClick={handleCreateProfile}
                disabled={loading}
                className="w-full py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading ? '创建中...' : '下一步: 配置采购季节'}
              </button>
            </div>
          )}

          {step === 'seasons' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">选择该客户采购的季节。系统会根据 {MARKET_LABELS[market].labelCn} 市场时间线自动计算所有关键节点。</p>

              {SEASONS.map((season) => {
                const config = MARKET_SEASONS[market][season];
                const sc = SEASON_COLORS[season];

                return (
                  <div key={season} className={`border rounded-lg p-3 ${activeSeasons[season] ? 'border-indigo-300 bg-indigo-50/30' : 'border-gray-200'}`}>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeSeasons[season]}
                        onChange={(e) => setActiveSeasons({ ...activeSeasons, [season]: e.target.checked })}
                        className="rounded text-indigo-600"
                      />
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sc.bgColor} ${sc.color}`}>
                        {season}
                      </span>
                      <span className="text-sm font-medium text-gray-900">{config.labelCn}</span>
                      <span className="text-xs text-gray-400 ml-auto">上架 {config.shelfMonthStart}-{config.shelfMonthEnd}月</span>
                    </label>

                    {activeSeasons[season] && (
                      <div className="mt-2 ml-8">
                        <input
                          type="text"
                          value={seasonCategories[season]}
                          onChange={(e) => setSeasonCategories({ ...seasonCategories, [season]: e.target.value })}
                          placeholder="该季采购品类 (如: t-shirt, hoodie)"
                          className="w-full border rounded px-2 py-1 text-xs"
                        />
                        <div className="text-xs text-gray-400 mt-1">
                          产品准备: {config.prepOffsetDays}天前 → 会议: {config.meetingOffsetDays}天前 → 下单: {config.orderOffsetDays}天前
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                onClick={handleSaveSeasons}
                disabled={loading || !Object.values(activeSeasons).some(Boolean)}
                className="w-full py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading ? '生成任务中...' : '保存并生成今明两年任务'}
              </button>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center py-6">
              <div className="text-3xl mb-3">&#10003;</div>
              <p className="text-sm text-gray-700 font-medium">客户 "{name}" 已创建</p>
              <p className="text-xs text-gray-500 mt-1">已生成 {new Date().getFullYear()} 和 {new Date().getFullYear() + 1} 年的采购节点任务</p>
              <button
                onClick={() => { reset(); setOpen(false); }}
                className="mt-4 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200"
              >
                关闭
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
