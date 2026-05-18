'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  Package,
  Truck,
  Bell,
  ArrowRightLeft,
} from 'lucide-react';
import { getCalendarEvents, CalendarEvent } from '@/lib/api';

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseEventDate(dateStr: string) {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  order: <Package className="h-3.5 w-3.5" />,
  stage_update: <ArrowRightLeft className="h-3.5 w-3.5" />,
  reminder: <Bell className="h-3.5 w-3.5" />,
  delivery: <Truck className="h-3.5 w-3.5" />,
};

const TYPE_LABELS: Record<string, string> = {
  order: 'Order Created',
  stage_update: 'Stage Update',
  reminder: 'Reminder',
  delivery: 'Delivery Scheduled',
};

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  useEffect(() => {
    setLoading(true);
    getCalendarEvents()
      .then(setEvents)
      .catch((err) => console.error('Failed to load calendar events', err))
      .finally(() => setLoading(false));
  }, []);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const d = parseEventDate(event.event_date);
      if (!d) continue;
      const key = formatDateKey(d);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(event);
    }
    return map;
  }, [events]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const startDay = monthStart.getDay(); // 0 = Sun
  const daysInMonth = monthEnd.getDate();

  const calendarDays: { date: Date; currentMonth: boolean }[] = [];

  // Previous month padding
  const prevMonthEnd = endOfMonth(addMonths(currentMonth, -1));
  for (let i = startDay - 1; i >= 0; i--) {
    calendarDays.push({
      date: new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), prevMonthEnd.getDate() - i),
      currentMonth: false,
    });
  }

  // Current month
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push({
      date: new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i),
      currentMonth: true,
    });
  }

  // Next month padding to fill 6 rows (42 cells)
  const remaining = 42 - calendarDays.length;
  for (let i = 1; i <= remaining; i++) {
    calendarDays.push({
      date: new Date(monthEnd.getFullYear(), monthEnd.getMonth() + 1, i),
      currentMonth: false,
    });
  }

  const selectedEvents = selectedDate
    ? eventsByDay.get(formatDateKey(selectedDate)) ?? []
    : [];

  const today = new Date();

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-[#2490ef]" />
            System Calendar
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Synced events from orders, stage updates, reminders & deliveries
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, -1))}
            className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50"
            title="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[140px] text-center text-sm font-medium text-gray-800">
            {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50"
            title="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              setCurrentMonth(new Date());
              setSelectedDate(new Date());
            }}
            className="ml-2 rounded-lg bg-[#2490ef] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1c7ad4]"
          >
            Today
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
          Loading calendar events…
        </div>
      ) : (
        <div className="flex flex-1 gap-4 overflow-hidden">
          {/* Calendar Grid */}
          <div className="flex flex-1 flex-col rounded-xl border border-gray-200 bg-white">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 border-b border-gray-200">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div
                  key={d}
                  className="py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-500"
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Days */}
            <div className="grid flex-1 grid-cols-7 grid-rows-6">
              {calendarDays.map(({ date, currentMonth: inMonth }, idx) => {
                const key = formatDateKey(date);
                const dayEvents = eventsByDay.get(key) ?? [];
                const isToday = isSameDay(date, today);
                const isSelected = selectedDate && isSameDay(date, selectedDate);

                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedDate(date)}
                    className={`relative flex flex-col items-start border-b border-r border-gray-100 p-2 transition-colors ${
                      inMonth ? 'bg-white hover:bg-gray-50' : 'bg-gray-50 text-gray-400'
                    } ${isSelected ? 'ring-1 ring-inset ring-[#2490ef]' : ''}`}
                  >
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                        isToday
                          ? 'bg-[#2490ef] text-white'
                          : inMonth
                            ? 'text-gray-700'
                            : 'text-gray-400'
                      }`}
                    >
                      {date.getDate()}
                    </span>

                    {/* Event dots */}
                    {dayEvents.length > 0 && (
                      <div className="mt-auto flex w-full flex-wrap gap-1 pt-1">
                        {dayEvents.slice(0, 4).map((e, i) => (
                          <span
                            key={i}
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: e.color }}
                            title={e.category}
                          />
                        ))}
                        {dayEvents.length > 4 && (
                          <span className="text-[10px] leading-3 text-gray-400">+{dayEvents.length - 4}</span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Event Detail Sidebar */}
          <div className="flex w-80 flex-col rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-800">
                {selectedDate
                  ? selectedDate.toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : 'Select a date'}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {selectedEvents.length} event{selectedEvents.length !== 1 ? 's' : ''}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {selectedEvents.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                  <CalendarIcon className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">No events for this day</p>
                </div>
              )}

              {selectedEvents.map((event) => (
                <div
                  key={`${event.type}-${event.event_id}`}
                  className="rounded-lg border border-gray-100 bg-gray-50 p-3"
                >
                  <div className="flex items-start gap-2">
                    <div
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white"
                      style={{ backgroundColor: event.color }}
                    >
                      {TYPE_ICONS[event.type] ?? <Clock className="h-3.5 w-3.5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {event.title}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {TYPE_LABELS[event.type] ?? event.category}
                        {event.subtitle ? ` • ${event.subtitle}` : ''}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-1 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(event.event_date).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {event.metadata ? ` • ${event.metadata}` : ''}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="border-t border-gray-200 p-3">
              <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Legend</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { type: 'order', label: 'Order Created', color: '#3b82f6' },
                  { type: 'stage_update', label: 'Stage Update', color: '#8b5cf6' },
                  { type: 'reminder', label: 'Reminder', color: '#ef4444' },
                  { type: 'delivery', label: 'Delivery', color: '#f97316' },
                ].map((item) => (
                  <div key={item.type} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-[11px] text-gray-600">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
