'use client';

import { useEffect, useState } from 'react';

interface User {
  user_id: string;
  name: string;
  role: string;
  sales_tier: string | null;
  created_at: string;
  lead_count: number;
}

const ROLES = ['销售', '管理员', '财务', '采购', '生产', '质检'] as const;
const TIERS = [
  { value: null, label: '—' },
  { value: 'top', label: 'Top' },
  { value: 'mid', label: 'Mid' },
] as const;

const ROLE_COLORS: Record<string, string> = {
  销售: 'bg-blue-100 text-blue-700',
  管理员: 'bg-purple-100 text-purple-700',
  财务: 'bg-amber-100 text-amber-700',
  采购: 'bg-green-100 text-green-700',
  生产: 'bg-gray-100 text-gray-700',
  质检: 'bg-pink-100 text-pink-700',
};

export default function UsersManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ ok: boolean; message: string; link?: string } | null>(null);

  // Invite form state
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>('销售');
  const [salesTier, setSalesTier] = useState<string | null>('mid');
  const [inviting, setInviting] = useState(false);

  async function loadUsers() {
    setLoading(true);
    const res = await fetch('/api/admin/users');
    const data = await res.json();
    if (data.users) setUsers(data.users);
    setLoading(false);
  }

  useEffect(() => { loadUsers(); }, []);

  async function invite() {
    if (!email || !name) return;
    setInviting(true);
    setInviteResult(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, role, sales_tier: role === '销售' ? salesTier : null }),
      });
      const data = await res.json();
      if (data.error) {
        setInviteResult({ ok: false, message: data.error });
      } else {
        setInviteResult({ ok: true, message: data.message, link: data.invite_link });
        setEmail('');
        setName('');
        await loadUsers();
      }
    } catch (e: any) {
      setInviteResult({ ok: false, message: e.message });
    } finally {
      setInviting(false);
    }
  }

  async function updateRole(userId: string, newRole: string, newTier: string | null) {
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, role: newRole, sales_tier: newTier }),
    });
    const data = await res.json();
    if (data.success) loadUsers();
    else alert(data.error);
  }

  return (
    <div className="space-y-4">
      {/* Invite button */}
      <div className="flex justify-between items-center">
        <div className="text-sm text-gray-500">共 {users.length} 个用户</div>
        <button
          onClick={() => { setShowInvite(!showInvite); setInviteResult(null); }}
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700"
        >
          {showInvite ? '取消' : '+ 邀请新用户'}
        </button>
      </div>

      {/* Invite form */}
      {showInvite && (
        <div className="bg-white border border-indigo-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">邀请新用户</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600">邮箱 *</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="sales@jojofashion.us"
                className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">姓名 *</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="张三"
                className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">角色</label>
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm"
              >
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            {role === '销售' && (
              <div>
                <label className="text-xs text-gray-600">销售层级</label>
                <select
                  value={salesTier || ''}
                  onChange={e => setSalesTier(e.target.value || null)}
                  className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm"
                >
                  <option value="mid">Mid (普通销售)</option>
                  <option value="top">Top (顶级销售，优先分高价值线索)</option>
                </select>
              </div>
            )}
          </div>
          <button
            onClick={invite}
            disabled={inviting || !email || !name}
            className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
          >
            {inviting ? '创建中...' : '创建账号 + 发邀请链接'}
          </button>
          {inviteResult && (
            <div className={`p-3 rounded text-sm ${inviteResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              <p className="font-medium">{inviteResult.ok ? '✅' : '❌'} {inviteResult.message}</p>
              {inviteResult.link && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-gray-600">邀请链接（发给对方完成密码设置）：</p>
                  <input
                    readOnly
                    value={inviteResult.link}
                    className="mt-1 w-full text-xs bg-white border border-gray-300 rounded px-2 py-1 font-mono"
                    onClick={e => (e.target as HTMLInputElement).select()}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* User list */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">加载中...</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">暂无用户</div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-500">姓名</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">角色</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">销售层级</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">分配线索</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">注册时间</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map(u => (
                <tr key={u.user_id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">{u.name}</td>
                  <td className="px-3 py-2">
                    <select
                      value={u.role}
                      onChange={e => updateRole(u.user_id, e.target.value, u.sales_tier)}
                      className={`text-xs px-2 py-1 rounded border-0 ${ROLE_COLORS[u.role] || 'bg-gray-100'}`}
                    >
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {u.role === '销售' ? (
                      <select
                        value={u.sales_tier || ''}
                        onChange={e => updateRole(u.user_id, u.role, e.target.value || null)}
                        className="text-xs px-2 py-1 rounded bg-gray-50 border border-gray-200"
                      >
                        <option value="mid">Mid</option>
                        <option value="top">Top</option>
                      </select>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-gray-700">{u.lead_count}</td>
                  <td className="px-3 py-2 text-right text-xs text-gray-400">
                    {new Date(u.created_at).toLocaleDateString('zh-CN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
