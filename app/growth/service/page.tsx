import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth';
import GrowthNavbar from '@/components/GrowthNavbar';

export default async function ConversationsPage() {
  await requireAuth();
  const supabase = await createClient();

  // Fetch conversations with latest message
  const { data: conversations } = await supabase
    .from('conversations')
    .select(`
      id, channel, external_id, customer_name, customer_phone, customer_email,
      status, escalated_at, created_at, updated_at
    `)
    .order('updated_at', { ascending: false })
    .limit(100);

  const allConversations = conversations || [];
  const escalated = allConversations.filter((c: any) => c.status === 'escalated');
  const active = allConversations.filter((c: any) => c.status === 'active');
  const resolved = allConversations.filter((c: any) => c.status === 'resolved' || c.status === 'archived');

  const channelLabel = (ch: string) =>
    ch === 'whatsapp' ? 'WhatsApp' : ch === 'shopify_form' ? 'Shopify' : 'Email';

  const channelColor = (ch: string) =>
    ch === 'whatsapp' ? 'bg-green-100 text-green-700' :
    ch === 'shopify_form' ? 'bg-purple-100 text-purple-700' :
    'bg-blue-100 text-blue-700';

  const statusBadge = (status: string) =>
    status === 'escalated' ? 'bg-red-100 text-red-700' :
    status === 'active' ? 'bg-green-100 text-green-700' :
    'bg-gray-100 text-gray-500';

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">Conversations</h1>
          <p className="text-sm text-gray-500 mt-1">WhatsApp + Shopify 自动回复对话管理</p>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-lg p-4 border border-red-200">
            <div className="text-2xl font-bold text-red-600">{escalated.length}</div>
            <div className="text-xs text-gray-500 mt-1">需人工处理</div>
          </div>
          <div className="bg-white rounded-lg p-4 border border-green-200">
            <div className="text-2xl font-bold text-green-600">{active.length}</div>
            <div className="text-xs text-gray-500 mt-1">AI 活跃对话</div>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="text-2xl font-bold text-gray-600">{resolved.length}</div>
            <div className="text-xs text-gray-500 mt-1">已处理</div>
          </div>
        </div>

        {/* Escalated (priority) */}
        {escalated.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-red-700 mb-2">需人工处理 ({escalated.length})</h2>
            <div className="space-y-2">
              {escalated.map((c: any) => (
                <ConversationRow key={c.id} conversation={c} channelLabel={channelLabel} channelColor={channelColor} statusBadge={statusBadge} />
              ))}
            </div>
          </div>
        )}

        {/* Active */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">活跃对话 ({active.length})</h2>
          {active.length === 0 ? (
            <p className="text-sm text-gray-400 py-4">暂无活跃对话。WhatsApp 和 Shopify 留言会自动出现在这里。</p>
          ) : (
            <div className="space-y-2">
              {active.map((c: any) => (
                <ConversationRow key={c.id} conversation={c} channelLabel={channelLabel} channelColor={channelColor} statusBadge={statusBadge} />
              ))}
            </div>
          )}
        </div>

        {/* Resolved */}
        {resolved.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-400 mb-2">已处理 ({resolved.length})</h2>
            <div className="space-y-2">
              {resolved.slice(0, 20).map((c: any) => (
                <ConversationRow key={c.id} conversation={c} channelLabel={channelLabel} channelColor={channelColor} statusBadge={statusBadge} />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ConversationRow({ conversation: c, channelLabel, channelColor, statusBadge }: any) {
  return (
    <div className="bg-white rounded-lg border px-4 py-3 flex items-center gap-3">
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${channelColor(c.channel)}`}>
        {channelLabel(c.channel)}
      </span>
      <span className={`px-2 py-0.5 rounded-full text-xs ${statusBadge(c.status)}`}>
        {c.status}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">
          {c.customer_name || c.customer_email || c.customer_phone || c.external_id}
        </div>
      </div>
      <span className="text-xs text-gray-400">
        {new Date(c.updated_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
}
