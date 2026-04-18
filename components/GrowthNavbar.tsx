'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Growth OS only — no Order OS routes. */
export default function GrowthNavbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [userRole, setUserRole] = useState<string>('');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const checkRole = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('user_id', user.id)
          .single();

        const role = profile?.role || '';
        setUserRole(role);
        setIsAdmin(role === '管理员');
      }
    };

    checkRole();
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const isSales = userRole === '销售' || isAdmin;

  const navLink = (href: string, label: string, active: boolean) => (
    <Link
      key={href}
      href={href}
      className={`
        sm:inline-flex sm:items-center sm:px-1 sm:pt-1 sm:border-b-2 sm:text-sm sm:font-medium
        block px-3 py-2 text-base font-medium rounded-md sm:rounded-none
        ${active
          ? 'sm:border-blue-500 text-gray-900 bg-blue-50 sm:bg-transparent'
          : 'sm:border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50 sm:hover:bg-transparent sm:hover:border-gray-300'
        }
      `}
    >
      {label}
    </Link>
  );

  const links: { href: string; label: string; show: boolean }[] = [
    { href: '/growth/workspace', label: '工作台', show: isSales },
    { href: '/growth/leads', label: '客户瀑布流', show: isSales },
    { href: '/growth/deals', label: '成交中心', show: isSales },
    { href: '/growth/outreach', label: '邮件开发', show: isSales },
    { href: '/growth/service', label: '客服中心', show: isSales },
    { href: '/growth/products', label: '新品发现', show: isSales },
    { href: '/growth/supervisor', label: 'AI监工', show: isAdmin },
    { href: '/growth/users', label: '团队管理', show: isAdmin },
    { href: '/growth/analytics', label: '数据中心', show: isAdmin },
  ];

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + '/');

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-14 sm:h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link
                href="/growth/workspace"
                className="text-lg sm:text-xl font-semibold text-gray-900"
              >
                Growth OS
              </Link>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-6">
              {links.filter((l) => l.show).map((l) =>
                navLink(l.href, l.label, isActive(l.href))
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleLogout}
              className="hidden sm:block text-gray-500 hover:text-gray-700 px-3 py-2 text-sm font-medium"
            >
              退出登录
            </button>
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="sm:hidden inline-flex items-center justify-center p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              aria-label="菜单"
            >
              {mobileOpen ? (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
      {mobileOpen && (
        <div className="sm:hidden border-t border-gray-200 bg-white pb-3 pt-2 px-2 space-y-1">
          {links.filter((l) => l.show).map((l) =>
            navLink(l.href, l.label, isActive(l.href))
          )}
          <button
            onClick={handleLogout}
            className="block w-full text-left px-3 py-2 text-base font-medium text-red-600 hover:bg-red-50 rounded-md"
          >
            退出登录
          </button>
        </div>
      )}
    </nav>
  );
}
