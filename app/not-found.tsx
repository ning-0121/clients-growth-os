import Link from 'next/link';
import GrowthNavbar from '@/components/GrowthNavbar';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50">
      <GrowthNavbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">404</h1>
          <p className="text-gray-600 mb-6">页面未找到</p>
          <Link
            href="/growth/my-today"
            className="inline-block bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
          >
            返回 Growth 首页
          </Link>
        </div>
      </div>
    </div>
  );
}
