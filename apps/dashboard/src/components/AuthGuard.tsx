'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getAllowedTabsForUser, routeMatchesTab, useAuth } from '@/lib/auth';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';

const PUBLIC_ROUTES = ['/login'];

export function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, user, accounts } = useAuth();
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
      return;
    }

    if (isAuthenticated && isPublic) {
      router.replace(user?.role === 'admin' ? '/' : '/orders');
      return;
    }

    // Redirect non-admin users away from unchecked tabs and direct URLs.
    if (isAuthenticated && user?.role !== 'admin') {
      const allowedTabs = getAllowedTabsForUser(user, accounts);
      const hasAllowedTabs = (allowedTabs?.length ?? 0) > 0;
      const hasAccess = allowedTabs?.some((tab) => routeMatchesTab(pathname, tab)) ?? true;

      if (hasAllowedTabs && !hasAccess) {
        router.replace(allowedTabs![0]);
      }
    }
  }, [accounts, isAuthenticated, user, pathname, ready, router]);

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

  const allowedTabs = getAllowedTabsForUser(user, accounts);
  const hasNoAllowedTabs = isAuthenticated && user?.role !== 'admin' && allowedTabs !== undefined && allowedTabs.length === 0;

  if (hasNoAllowedTabs) {
    return (
      <div className="flex min-h-dvh w-full overflow-x-hidden bg-[#f4f5f7]">
        <Sidebar mobileOpen={mobileMenuOpen} onMobileClose={() => setMobileMenuOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header onMenuClick={() => setMobileMenuOpen(true)} />
          <main className="flex min-w-0 flex-1 items-center justify-center overflow-x-hidden p-3 sm:p-4 lg:p-6">
            <div className="max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
              <h1 className="text-lg font-semibold text-gray-900">No tab access assigned</h1>
              <p className="mt-2 text-sm text-gray-600">
                Your account has no enabled dashboard tabs. Please ask an admin to update your Tab Access settings.
              </p>
            </div>
          </main>
        </div>
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
