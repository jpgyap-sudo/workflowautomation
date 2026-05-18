'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';

const PUBLIC_ROUTES = ['/login'];

export function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  // Wait for auth hydration to complete
  useEffect(() => {
    // Short timeout to let the AuthProvider hydrate from localStorage
    const timer = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready) return;

    const isPublic = PUBLIC_ROUTES.includes(pathname);

    if (!isAuthenticated && !isPublic) {
      router.replace('/login');
    } else if (isAuthenticated && isPublic) {
      router.replace('/');
    }
  }, [isAuthenticated, pathname, ready, router]);

  // Show nothing while hydrating
  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f4f5f7]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
  }

  const isPublic = PUBLIC_ROUTES.includes(pathname);

  // Public routes (login) render without sidebar/header
  if (isPublic) {
    return <>{children}</>;
  }

  // Protected routes render with the full dashboard layout
  if (!isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f4f5f7]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
  }

  return (
    <>
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </>
  );
}
