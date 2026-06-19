'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  ShoppingCart,
  Factory,
  Package,
  PackageCheck,
  Truck,
  DollarSign,
  BarChart3,
  ClipboardList,
  Activity,
  CalendarDays,
  GitFork,
  ChevronLeft,
  ChevronRight,
  Settings,
  Bot,
  Database,
  ScanEye,
  MessageSquare,
  X,
  Users,
  Zap,
  Smartphone,
  Bug,
  BookOpen,
  History,
  BrainCircuit,
} from 'lucide-react';
import { useState, type ComponentType } from 'react';
import { getAllowedTabsForUser, useAuth, type TabRoute } from '@/lib/auth';

type NavItem = {
  href: TabRoute;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const ALL_NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/guides', label: 'Guides', icon: BookOpen },
  { href: '/orders', label: 'All Orders', icon: FileText },
  { href: '/actions', label: 'Quick Actions', icon: Zap },
  { href: '/clients', label: 'Clients', icon: Users },
  { href: '/purchasing', label: 'Purchasing', icon: ShoppingCart },
  { href: '/production', label: 'Production', icon: Factory },
  { href: '/inventory', label: 'Inventory', icon: Package },
  { href: '/stock-prep', label: 'Stock Prep', icon: PackageCheck },
  { href: '/delivery', label: 'Delivery', icon: Truck },
  { href: '/sales', label: 'Sales', icon: BarChart3 },
  { href: '/collection', label: 'Collection', icon: DollarSign },
  { href: '/stages', label: 'Stage Pipeline', icon: ClipboardList },
  { href: '/workflow', label: 'Workflow', icon: GitFork },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/logs', label: 'Agent Logs', icon: Activity },
  { href: '/bot-logs', label: 'Bot Logs', icon: MessageSquare },
  { href: '/bugs', label: 'Bug Report', icon: Bug },
  { href: '/telegram', label: 'Telegram', icon: Smartphone },
  { href: '/backup', label: 'Backups', icon: Database },
  { href: '/vision', label: 'Vision Upload', icon: ScanEye },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/update-logs', label: 'Update Logs', icon: History },
  { href: '/brain', label: 'CentralBrain', icon: BrainCircuit },
];

function useFilteredNavItems() {
  const { user, accounts } = useAuth();
  const allowedTabs = getAllowedTabsForUser(user, accounts);

  // Admin has undefined access (all tabs). Non-admins only get explicitly allowed tabs.
  if (allowedTabs === undefined) return ALL_NAV_ITEMS;

  return ALL_NAV_ITEMS.filter((item) => allowedTabs.includes(item.href));
}

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

function SidebarBrand({ collapsed = false, onClose }: { collapsed?: boolean; onClose?: () => void }) {
  return (
    <div className="flex h-14 items-center justify-between border-b border-[var(--sidebar-border)] px-4">
      <div className="flex items-center gap-2.5 overflow-hidden">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[--primary] p-1 shadow-sm">
          <img src="/icons/icon.svg" alt="Logo" className="h-full w-full" />
        </div>
        <span
          className={`whitespace-nowrap text-sm font-semibold text-[var(--sidebar-text)] transition-opacity ${
            collapsed ? 'w-0 opacity-0' : 'opacity-100'
          }`}
        >
          Workflow Automation
        </span>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-[var(--sidebar-text-muted)] hover:bg-[var(--sidebar-hover)] transition-colors"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const navItems = useFilteredNavItems();

  return (
    <nav className="flex-1 overflow-y-auto p-2">
      <ul className="space-y-0.5">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                className={`flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150 ${
                  isActive
                    ? 'bg-[--sidebar-active] font-medium text-white shadow-sm'
                    : 'text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-text)]'
                }`}
                title={collapsed ? item.label : undefined}
              >
                <Icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-white' : 'text-[var(--sidebar-text-muted)]'}`} />
                <span
                  className={`whitespace-nowrap transition-opacity ${
                    collapsed ? 'w-0 opacity-0' : 'opacity-100'
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      <aside
        className={`hidden shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] transition-all duration-200 lg:flex ${
          collapsed ? 'w-16' : 'w-60'
        }`}
      >
        <SidebarBrand collapsed={collapsed} />
        <SidebarNav collapsed={collapsed} />
        <div className="border-t border-[var(--sidebar-border)] p-2">
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--sidebar-text-muted)] transition-colors hover:bg-[var(--sidebar-hover)]"
          >
            {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
            <span className={collapsed ? 'hidden' : ''}>Collapse</span>
          </button>
        </div>
      </aside>

      <div
        className={`fixed inset-0 z-50 lg:hidden ${mobileOpen ? '' : 'pointer-events-none'}`}
        aria-hidden={!mobileOpen}
      >
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onMobileClose}
          className={`absolute inset-0 bg-black/40 transition-opacity ${mobileOpen ? 'opacity-100' : 'opacity-0'}`}
        />
        <aside
          className={`absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] shadow-xl transition-transform duration-200 ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <SidebarBrand onClose={onMobileClose} />
          <SidebarNav collapsed={false} onNavigate={onMobileClose} />
        </aside>
      </div>
    </>
  );
}
