'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  ShoppingCart,
  Package,
  Truck,
  DollarSign,
  BarChart3,
  ClipboardList,
  Activity,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Settings,
  Bot,
} from 'lucide-react';
import { useState } from 'react';

const NAV_ITEMS = [
  { href: '/',            label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/orders',      label: 'All Orders',     icon: FileText },
  { href: '/purchasing',  label: 'Purchasing',     icon: ShoppingCart },
  { href: '/inventory',   label: 'Inventory',      icon: Package },
  { href: '/delivery',    label: 'Delivery',       icon: Truck },
  { href: '/sales',       label: 'Sales',          icon: BarChart3 },
  { href: '/collection',  label: 'Collection',     icon: DollarSign },
  { href: '/stages',      label: 'Stage Pipeline', icon: ClipboardList },
  { href: '/calendar',    label: 'Calendar',       icon: CalendarDays },
  { href: '/agents',      label: 'Agents',         icon: Bot },
  { href: '/logs',        label: 'Agent Logs',     icon: Activity },
  { href: '/settings',    label: 'Settings',       icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`flex flex-col border-r border-gray-200 bg-white transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-gray-200 px-4">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#2490ef] text-sm font-bold text-white">
            Q
          </div>
          <span
            className={`whitespace-nowrap text-sm font-semibold text-gray-800 transition-opacity ${
              collapsed ? 'opacity-0 w-0' : 'opacity-100'
            }`}
          >
            Quotation System
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-[#e8f4fd] text-[#2490ef] font-medium'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span
                    className={`whitespace-nowrap transition-opacity ${
                      collapsed ? 'opacity-0 w-0' : 'opacity-100'
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

      {/* Collapse toggle */}
      <div className="border-t border-gray-200 p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100"
        >
          {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
          <span className={`${collapsed ? 'hidden' : ''}`}>Collapse</span>
        </button>
      </div>
    </aside>
  );
}
