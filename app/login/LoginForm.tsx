'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { login, signup } from '../actions/auth';

export default function LoginForm() {
  const router = useRouter();
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // 倒计时效果
  useEffect(() => {
    if (cooldownSeconds > 0) {
      const timer = setTimeout(() => {
        setCooldownSeconds(cooldownSeconds - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldownSeconds]);

  // 检测 rate limit 错误并提取等待秒数
  const detectRateLimit = (errorMessage: string): number | null => {
    const lowerMsg = errorMessage.toLowerCase();
    if (
      lowerMsg.includes('only request this after') ||
      lowerMsg.includes('too many requests') ||
      lowerMsg.includes('rate limit')
    ) {
      // 尝试从错误消息中提取秒数
      const secondsMatch = errorMessage.match(/(\d+)\s*秒/i) || errorMessage.match(/(\d+)\s*second/i);
      if (secondsMatch) {
        return parseInt(secondsMatch[1], 10);
      }
      // 如果没有找到具体秒数，默认 60 秒
      return 60;
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    setIsLoading(true);
    setError(null);
    setCooldownSeconds(0);

    const form = e.currentTarget;
    const formData = new FormData(form);
    const email = formData.get('email') as string;
    const mode = isLogin ? 'login' : 'register';

    // 调试输出
    console.log('submit', { mode, email });

    try {
      const result = isLogin ? await login(formData) : await signup(formData);
      
      // 调试输出
      console.log('result', result);

      if (result?.error) {
        const waitSeconds = detectRateLimit(result.error);
        if (waitSeconds !== null) {
          setError(`操作过于频繁，请 ${waitSeconds} 秒后再试`);
          setCooldownSeconds(waitSeconds);
        } else {
          setError(result.error);
        }
        setIsLoading(false);
      } else {
        router.push('/growth/my-today');
        router.refresh();
      }
    } catch (err: any) {
      console.log('result', { error: err });
      const errorMsg = err?.message || '登录失败，请重试';
      const waitSeconds = detectRateLimit(errorMsg);
      if (waitSeconds !== null) {
        setError(`操作过于频繁，请 ${waitSeconds} 秒后再试`);
        setCooldownSeconds(waitSeconds);
      } else {
        setError(errorMsg);
      }
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      <div className="rounded-md shadow-sm -space-y-px">
        {!isLogin && (
          <>
            <div>
              <label htmlFor="name" className="sr-only">
                姓名
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder="姓名"
              />
            </div>
            <div>
              <label htmlFor="role" className="sr-only">
                角色
              </label>
              <select
                id="role"
                name="role"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
              >
                <option value="销售">销售</option>
                <option value="财务">财务</option>
                <option value="采购">采购</option>
                <option value="生产">生产</option>
                <option value="质检">质检</option>
                <option value="管理员">管理员</option>
              </select>
            </div>
          </>
        )}
        <div>
          <label htmlFor="email" className="sr-only">
            邮箱
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className={`appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 ${
              !isLogin ? '' : 'rounded-t-md'
            } focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm`}
            placeholder="邮箱地址"
          />
        </div>
        <div>
          <label htmlFor="password" className="sr-only">
            密码
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
            placeholder="密码"
          />
        </div>
      </div>

      <div>
        <button
          type="submit"
          disabled={isLoading || cooldownSeconds > 0}
          className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading
            ? '处理中...'
            : cooldownSeconds > 0
            ? `请等待 ${cooldownSeconds} 秒`
            : isLogin
            ? '登录'
            : '注册'}
        </button>
      </div>

      <div className="text-center">
        <button
          type="button"
          onClick={() => {
            setIsLogin(!isLogin);
            setError(null);
          }}
          className="text-sm text-blue-600 hover:text-blue-500"
        >
          {isLogin ? '没有账户？点击注册' : '已有账户？点击登录'}
        </button>
      </div>
    </form>
  );
}

