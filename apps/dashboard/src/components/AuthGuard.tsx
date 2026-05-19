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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
      <div className="flex min-h-dvh w-full overflow-x-hidden bg-[#f4f5f7]">
        <Sidebar mobileOpen={mobileMenuOpen} onMobileClose={() => setMobileMenuOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header onMenuClick={() => setMobileMenuOpen(true)} />
          <main className="min-w-0 flex-1 overflow-x-hidden p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-4 lg:p-6">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
