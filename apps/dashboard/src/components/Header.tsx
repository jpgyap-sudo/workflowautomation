'use client';

import { Bell, RefreshCw, LogOut, Menu, Search, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useState, useRef, useEffect } from 'react';
import { searchOrders, Order } from '@/lib/api';

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
  const displayName = user?.name ?? user?.email ?? 'User';
  const initials = displayName.charAt(0).toUpperCase();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Order[]>([]);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  function handleLogout() {
    logout();
    router.replace('/login');
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
        setSearchQuery('');
        setSearchResults([]);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (searchOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [searchOpen]);

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const result = await searchOrders(value.trim());
        setSearchResults(result.orders);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  function handleSelectOrder(quotationNumber: string | null) {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    if (quotationNumber) {
      router.push(`/orders/${encodeURIComponent(quotationNumber)}`);
    }
  }

  return (
    <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between border-b border-[var(--border-color)] bg-white/95 backdrop-blur-sm px-3 sm:px-4 lg:px-6 shadow-[var(--shadow-sm)]">
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
        {/* Search */}
        <div ref={searchRef} className="relative">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className={`rounded-lg p-2 transition-colors ${
              searchOpen ? 'bg-[var(--primary-light)] text-[var(--primary)]' : 'text-gray-500 hover:bg-gray-100'
            }`}
            title="Search orders"
          >
            {searchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
          </button>

          {searchOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-gray-200 bg-white shadow-lg">
              <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
                <Search className="h-4 w-4 shrink-0 text-gray-400" />
                <input
                  ref={inputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search by client, order #, agent..."
                  className="w-full bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
                />
                {searching && (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-[var(--primary)]" />
                )}
              </div>

              {searchResults.length > 0 && (
                <div className="max-h-64 overflow-y-auto p-1">
                  {searchResults.map((order) => (
                    <button
                      key={order.id}
                      onClick={() => handleSelectOrder(order.quotation_number)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-medium text-gray-600">
                        {order.client_name?.charAt(0) ?? '?'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-gray-800">
                          {order.client_name ?? 'Unknown Client'}
                        </p>
                        <p className="truncate text-xs text-gray-500">
                          {order.quotation_number ?? 'No order #'} • {order.sales_agent ?? 'N/A'}
                        </p>
                      </div>
                      <span className="shrink-0 text-[10px] text-gray-400">
                        {order.current_stage.replace(/_/g, ' ')}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {searchQuery.trim().length >= 2 && searchResults.length === 0 && !searching && (
                <div className="px-3 py-6 text-center text-sm text-gray-400">
                  No orders found for &quot;{searchQuery}&quot;
                </div>
              )}

              {searchQuery.trim().length < 2 && (
                <div className="px-3 py-6 text-center text-sm text-gray-400">
                  Type at least 2 characters to search
                </div>
              )}
            </div>
          )}
        </div>

        <button className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" title="Refresh" onClick={() => router.refresh()}>
          <RefreshCw className="h-4 w-4" />
        </button>
        <button className="hidden rounded-lg p-2 text-gray-500 hover:bg-gray-100 sm:inline-flex" title="Notifications">
          <Bell className="h-4 w-4" />
        </button>
        <div className="hidden h-6 w-px bg-gray-200 sm:block" />
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--primary)] text-xs font-medium text-white">
            {initials}
          </div>
          <span className="hidden max-w-[10rem] truncate text-sm text-gray-600 sm:inline">{displayName}</span>
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
