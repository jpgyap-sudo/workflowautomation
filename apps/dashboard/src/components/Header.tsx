'use client';

import { Bell, Search, RefreshCw } from 'lucide-react';
import { usePathname } from 'next/navigation';

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

export default function Header() {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] ?? 'Dashboard';

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-gray-800">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        <button className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </button>
        <button className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" title="Notifications">
          <Bell className="h-4 w-4" />
        </button>
        <div className="h-6 w-px bg-gray-200" />
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2490ef] text-xs font-medium text-white">
            A
          </div>
          <span className="text-sm text-gray-600">Admin</span>
        </div>
      </div>
    </header>
  );
}
