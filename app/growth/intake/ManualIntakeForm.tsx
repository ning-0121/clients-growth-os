'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { runManualIntake } from '@/app/actions/manual-intake';
import { LeadSource } from '@/lib/types';

const SOURCE_OPTIONS: { value: LeadSource; label: string }[] = [
  { value: 'website', label: 'Website' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'ig', label: 'Instagram' },
  { value: 'customs', label: '海关数据' },
  { value: 'referral', label: '推荐' },
];

export default function ManualIntakeForm() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string } | null>(null);
  const [form, setForm] = useState({
    company_name: '',
    contact_name: '',
    source: 'website' as LeadSource,
    website: '',
    product_match: '',
    contact_email: '',
    contact_linkedin: '',
    instagram_handle: '',
  });

  const update = (field: string, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.company_name.trim()) return;

    setIsLoading(true);
    setResult(null);

    try {
      const res = await runManualIntake({
        company_name: form.company_name.trim(),
        contact_name: form.contact_name.trim() || undefined,
        source: form.source,
        website: form.website.trim() || undefined,
        product_match: form.product_match.trim() || undefined,
        contact_email: form.contact_email.trim() || undefined,
        contact_linkedin: form.contact_linkedin.trim() || undefined,
        instagram_handle: form.instagram_handle.trim() || undefined,
      });

      setResult(res);
      if (res.success) {
        setForm({
          company_name: '', contact_name: '', source: 'website',
          website: '', product_match: '', contact_email: '',
          contact_linkedin: '', instagram_handle: '',
        });
        router.refresh();
      }
    } catch {
      setResult({ error: '提交失败' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="公司名称 *" value={form.company_name} onChange={(v) => update('company_name', v)} required />
        <Field label="联系人" value={form.contact_name} onChange={(v) => update('contact_name', v)} />
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">来源 *</label>
          <select
            value={form.source}
            onChange={(e) => update('source', e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <Field label="网站" value={form.website} onChange={(v) => update('website', v)} placeholder="https://" />
        <Field label="产品匹配" value={form.product_match} onChange={(v) => update('product_match', v)} />
        <Field label="邮箱" value={form.contact_email} onChange={(v) => update('contact_email', v)} type="email" />
        <Field label="LinkedIn" value={form.contact_linkedin} onChange={(v) => update('contact_linkedin', v)} />
        <Field label="Instagram" value={form.instagram_handle} onChange={(v) => update('instagram_handle', v)} placeholder="@handle" />
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="text-sm">
          {result?.error && <span className="text-red-600">{result.error}</span>}
          {result?.success && <span className="text-green-600">线索已提交，进入评分流程</span>}
        </div>
        <button
          type="submit"
          disabled={isLoading || !form.company_name.trim()}
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? '提交中...' : '提交线索'}
        </button>
      </div>
    </form>
  );
}

function Field({
  label, value, onChange, placeholder, type = 'text', required = false,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  );
}
