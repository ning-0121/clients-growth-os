import { requireAuth, getCurrentProfile } from '@/lib/auth';
import { redirect } from 'next/navigation';
import GrowthNavbar from '@/components/GrowthNavbar';
import UsersManagement from './UsersManagement';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
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
          <h1 className="text-xl font-bold text-gray-900">团队管理</h1>
          <p className="text-sm text-gray-500 mt-1">添加销售/管理员账号，分配角色，管理分级</p>
        </div>
        <UsersManagement />
      </main>
    </div>
  );
}
