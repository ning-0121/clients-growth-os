import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { redirect } from 'next/navigation';
import GrowthNavbar from '@/components/GrowthNavbar';
import CustomsUploadPanel from '../intake/CustomsUploadPanel';

export const dynamic = 'force-dynamic';

export default async function CustomsImportPage() {
  await requireAuth();
  const profile = await getCurrentProfile();
  if (profile?.role !== '管理员') {
    redirect('/growth/workspace');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">海关数据导入</h1>
          <p className="text-sm text-gray-500 mt-1">
            上传特易数据 / 海关提单 CSV / Excel，导入后 Round 3 验证会自动激活
          </p>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <p className="text-xs text-amber-800">
            <strong>当前状态：</strong>海关 Round 3 验证已停用（<code>SKIP_CUSTOMS_VERIFICATION=true</code>）。
            导入数据后，在 Vercel 环境变量里改成 <code>SKIP_CUSTOMS_VERIFICATION=false</code>，
            重新部署即可激活海关交叉验证。
          </p>
        </div>

        <CustomsUploadPanel />
      </main>
    </div>
  );
}
