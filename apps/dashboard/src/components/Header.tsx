'use client';

import { Bell, RefreshCw, LogOut, Menu } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/orders': 'All Orders',
  '/purchasing': 'Purchasing & Production',
  '/inventory': 'Inventory Arrival',
  '/delivery': 'Delivery Tracking',
  '/collection': 'Counter & Collection',
  '/stages': 'Stage Pipeline',
  '/calendar': 'Calendar',
  '/logs': 'Agent Logs',
};

export default function Header({ onMenuClick }: { onMenuClick?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const title = PAGE_TITLES[pathname] ?? 'Dashboard';
  const initials = user?.email?.charAt(0).toUpperCase() ?? 'A';

  function handleLogout() {
    logout();
    router.replace('/login');
  }

  return (
    <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between border-b border-gray-200 bg-white px-3 sm:px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        <button
          type="button"
          onClick={onMenuClick}
          className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="truncate text-base font-semibold text-gray-800 sm:text-lg">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-3">
        <button className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </button>
        <button className="hidden rounded-lg p-2 text-gray-500 hover:bg-gray-100 sm:inline-flex" title="Notifications">
          <Bell className="h-4 w-4" />
        </button>
        <div className="hidden h-6 w-px bg-gray-200 sm:block" />
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2490ef] text-xs font-medium text-white">
            {initials}
          </div>
          <span className="hidden max-w-[10rem] truncate text-sm text-gray-600 sm:inline">{user?.email ?? 'Admin'}</span>
        </div>
        <button
          onClick={handleLogout}
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
