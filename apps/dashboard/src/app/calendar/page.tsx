'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from 'swr';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  Package,
  Truck,
  Bell,
  ArrowRightLeft,
  StickyNote,
  Plus,
  Pencil,
  Trash2,
  X,
  CreditCard,
  Banknote,
  Factory,
  Flag,
  CheckCircle2,
  Ship,
  Send,
  MessageSquare,
  ArrowUpCircle,
  CalendarDays,
} from 'lucide-react';
import { useCalendarEvents, useCalendarNotes } from '@/lib/useApi';
import {
  CalendarEvent,
  CalendarNote,
  CalendarSchedule,
  createCalendarNote,
  updateCalendarNote,
  deleteCalendarNote,
  createCalendarSchedule,
  updateCalendarSchedule,
  deleteCalendarSchedule,
  recordStageUpdate,
  sendTelegramNotification,
} from '@/lib/api';
import OtpModal from '@/components/OtpModal';

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
  deposit: <CreditCard className="h-3.5 w-3.5" />,
  balance: <Banknote className="h-3.5 w-3.5" />,
  production_start: <Factory className="h-3.5 w-3.5" />,
  production_finish: <Flag className="h-3.5 w-3.5" />,
  en_route: <Ship className="h-3.5 w-3.5" />,
  order_confirmed: <CheckCircle2 className="h-3.5 w-3.5" />,
  schedule: <CalendarDays className="h-3.5 w-3.5" />,
};

const TYPE_LABELS: Record<string, string> = {
  order: 'Order Created',
  stage_update: 'Stage Update',
  reminder: 'Reminder',
  delivery: 'Delivery Scheduled',
  deposit: 'Deposit Paid',
  balance: 'Balance Paid',
  production_start: 'Production Started',
  production_finish: 'Production Finished',
  en_route: 'Inventory En Route',
  order_confirmed: 'Order Confirmed',
  schedule: 'Schedule',
};

const NOTE_COLORS = ['#2490ef', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

export default function CalendarPage() {
  const router = useRouter();
  const { data: events = [], isLoading } = useCalendarEvents();
  const { data: notes = [], isLoading: notesLoading } = useCalendarNotes();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // Note editor state
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [editingNote, setEditingNote] = useState<CalendarNote | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteColor, setNoteColor] = useState('#2490ef');
  const [savingNote, setSavingNote] = useState(false);
  const [otpModal, setOtpModal] = useState<{
    open: boolean; title: string; description: string; pendingAction: 'save' | 'delete' | 'stageAdvance' | 'telegramNotify' | 'scheduleSave' | 'scheduleDelete';
  }>({ open: false, title: '', description: '', pendingAction: 'save' });

  // Schedule state
  const [schedules, setSchedules] = useState<CalendarSchedule[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [showScheduleEditor, setShowScheduleEditor] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<CalendarSchedule | null>(null);
  const [scheduleTitle, setScheduleTitle] = useState('');
  const [scheduleDescription, setScheduleDescription] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduleEndTime, setScheduleEndTime] = useState('');
  const [scheduleIsAllDay, setScheduleIsAllDay] = useState(false);
  const [scheduleColor, setScheduleColor] = useState('#f59e0b');
  const [savingSchedule, setSavingSchedule] = useState(false);

  // Stage advance action state
  const [pendingStageAdvance, setPendingStageAdvance] = useState<{
    quotationNumber: string; targetStage: string; label: string;
  } | null>(null);

  // Telegram notify state
  const [showTelegramNotify, setShowTelegramNotify] = useState(false);
  const [telegramMessage, setTelegramMessage] = useState('');

  // Reminder creation state
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderOrderId, setReminderOrderId] = useState('');
  const [reminderStage, setReminderStage] = useState('');
  const [reminderMessage, setReminderMessage] = useState('');
  const [reminderFrequency, setReminderFrequency] = useState<'hourly' | 'daily' | 'once'>('daily');
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

  const notesByDay = useMemo(() => {
    const map = new Map<string, CalendarNote[]>();
    for (const note of notes) {
      const key = note.note_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(note);
    }
    return map;
  }, [notes]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const startDay = monthStart.getDay();
  const daysInMonth = monthEnd.getDate();

  const calendarDays: { date: Date; currentMonth: boolean }[] = [];

  const prevMonthEnd = endOfMonth(addMonths(currentMonth, -1));
  for (let i = startDay - 1; i >= 0; i--) {
    calendarDays.push({
      date: new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), prevMonthEnd.getDate() - i),
      currentMonth: false,
    });
  }

  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push({
      date: new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i),
      currentMonth: true,
    });
  }

  const remaining = 42 - calendarDays.length;
  for (let i = 1; i <= remaining; i++) {
    calendarDays.push({
      date: new Date(monthEnd.getFullYear(), monthEnd.getMonth() + 1, i),
      currentMonth: false,
    });
  }

  const selectedDateKey = selectedDate ? formatDateKey(selectedDate) : null;
  const selectedEvents = selectedDateKey ? eventsByDay.get(selectedDateKey) ?? [] : [];
  const selectedNotes = selectedDateKey ? notesByDay.get(selectedDateKey) ?? [] : [];

  const today = new Date();

  function openNewNote() {
    setEditingNote(null);
    setNoteTitle('');
    setNoteContent('');
    setNoteColor('#2490ef');
    setShowNoteEditor(true);
  }

  function openEditNote(note: CalendarNote) {
    setEditingNote(note);
    setNoteTitle(note.title);
    setNoteContent(note.content);
    setNoteColor(note.color);
    setShowNoteEditor(true);
  }

  function handleSaveNote() {
    if (!noteTitle.trim() || !selectedDate) return;
    const isEdit = !!editingNote;
    (window as any).__pendingNoteData = { isEdit, dateKey: formatDateKey(selectedDate) };
    setOtpModal({
      open: true,
      title: isEdit ? 'Edit Note' : 'Save Note',
      description: `You are about to ${isEdit ? 'edit' : 'create'} the note "${noteTitle.trim()}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'save',
    });
  }

  async function handleSaveVerified(actionToken: string) {
    if (!noteTitle.trim() || !selectedDate) return;
    setSavingNote(true);
    try {
      if (editingNote) {
        await updateCalendarNote(editingNote.id, {
          title: noteTitle.trim(), content: noteContent, color: noteColor, action_token: actionToken,
        });
      } else {
        await createCalendarNote({
          note_date: formatDateKey(selectedDate), title: noteTitle.trim(), content: noteContent, color: noteColor, action_token: actionToken,
        });
      }
      await mutate('/calendar/notes');
      setShowNoteEditor(false);
    } catch (e) {
      console.error('Failed to save note', e);
    } finally {
      setSavingNote(false);
      (window as any).__pendingNoteData = null;
    }
  }

  function handleDeleteNote(noteId: string) {
    const note = notes.find((n) => n.id === noteId);
    (window as any).__pendingNoteDelete = noteId;
    setOtpModal({
      open: true,
      title: 'Delete Note',
      description: `You are about to delete the note "${note?.title ?? noteId}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'delete',
    });
  }

  async function handleDeleteVerified(actionToken: string) {
    const noteId = (window as any).__pendingNoteDelete;
    if (!noteId) return;
    try {
      await deleteCalendarNote(noteId, actionToken);
      await mutate('/calendar/notes');
      if (editingNote?.id === noteId) setShowNoteEditor(false);
    } catch (e) {
      console.error('Failed to delete note', e);
    } finally {
      (window as any).__pendingNoteDelete = null;
    }
  }

  function navigateToOrder(event: CalendarEvent) {
    if (event.title && event.title !== 'Unknown') {
      router.push(`/orders/${encodeURIComponent(event.title)}`);
    }
  }

  // ── Stage Advance Actions ──────────────────────────────────────────
  const STAGE_ADVANCE_ACTIONS: Record<string, { stage: string; label: string; icon: React.ReactNode }[]> = {
    deposit_pending:       [{ stage: 'deposit_verification', label: 'Verify Deposit', icon: <CreditCard className="h-3 w-3" /> }],
    deposit_verification:  [{ stage: 'purchasing_pending', label: 'Advance to Purchasing', icon: <ArrowUpCircle className="h-3 w-3" /> }],
    purchasing_pending:    [{ stage: 'production_pending', label: 'Start Production', icon: <Factory className="h-3 w-3" /> }],
    production_confirmed:  [{ stage: 'en_route', label: 'Mark En Route', icon: <Ship className="h-3 w-3" /> }],
    inventory_arrived:     [{ stage: 'balance_due', label: 'Mark Arrived', icon: <CheckCircle2 className="h-3 w-3" /> }],
    balance_due:           [{ stage: 'balance_verification', label: 'Verify Balance', icon: <Banknote className="h-3 w-3" /> }],
    balance_verification:  [{ stage: 'delivery_pending', label: 'Proceed Delivery', icon: <Truck className="h-3 w-3" /> }],
    delivery_pending:      [{ stage: 'delivery_scheduled', label: 'Schedule Delivery', icon: <Truck className="h-3 w-3" /> }],
    delivery_scheduled:    [{ stage: 'delivered', label: 'Mark Delivered', icon: <CheckCircle2 className="h-3 w-3" /> }],
    delivered:             [{ stage: 'payment_received', label: 'Payment Received', icon: <CreditCard className="h-3 w-3" /> }],
    countered:             [{ stage: 'payment_received', label: 'Payment Received', icon: <CreditCard className="h-3 w-3" /> }],
    payment_received:      [{ stage: 'payment_confirmed', label: 'Confirm Payment', icon: <CheckCircle2 className="h-3 w-3" /> }],
    payment_confirmed:     [{ stage: 'completed', label: 'Complete Order', icon: <Flag className="h-3 w-3" /> }],
  };

  function handleStageAdvance(event: CalendarEvent, targetStage: string, label: string) {
    setPendingStageAdvance({ quotationNumber: event.title, targetStage, label });
    setOtpModal({
      open: true,
      title: `Advance Stage: ${label}`,
      description: `You are about to advance order "${event.title}" to "${targetStage}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'stageAdvance',
    });
  }

  async function executeStageAdvance(actionToken: string) {
    if (!pendingStageAdvance) return;
    try {
      await recordStageUpdate({
        quotation_number: pendingStageAdvance.quotationNumber,
        stage: pendingStageAdvance.targetStage,
        status: 'completed',
        remarks: `Advanced from calendar — ${pendingStageAdvance.label}`,
        action_token: actionToken,
      });
      await mutate('/calendar/events');
      await mutate('/orders');
    } catch (e) {
      console.error('Failed to advance stage', e);
    } finally {
      setPendingStageAdvance(null);
    }
  }

  // ── Telegram Notification ──────────────────────────────────────────
  function openTelegramNotify() {
    setTelegramMessage('');
    setShowTelegramNotify(true);
  }

  function handleSendTelegramNotify() {
    if (!telegramMessage.trim() || !selectedDate) return;
    setOtpModal({
      open: true,
      title: 'Send Telegram Notification',
      description: `You are about to send a notification to the escalation group about "${selectedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'telegramNotify',
    });
  }

  async function executeTelegramNotify(actionToken: string) {
    if (!telegramMessage.trim()) return;
    try {
      const dateStr = selectedDate?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) ?? '';
      const msg = `📅 <b>Calendar Notification — ${dateStr}</b>\n\n${telegramMessage.trim()}`;
      await sendTelegramNotification(msg, actionToken);
      setShowTelegramNotify(false);
      setTelegramMessage('');
    } catch (e) {
      console.error('Failed to send Telegram notification', e);
    }
  }

  // ── Reminder Creation ──────────────────────────────────────────────
  function openReminderModal(event: CalendarEvent) {
    setReminderOrderId(event.event_id);
    setReminderStage(event.metadata ?? '');
    setReminderMessage(`Reminder for order ${event.title}`);
    setReminderFrequency('daily');
    setShowReminderModal(true);
  }

  async function handleCreateReminder() {
    if (!reminderOrderId || !reminderMessage.trim()) return;
    try {
      const { createReminder } = await import('@/lib/api');
      await createReminder({
        order_id: reminderOrderId,
        stage: reminderStage || 'general',
        group_chat_id: '',
        message: reminderMessage.trim(),
        frequency: reminderFrequency,
      });
      await mutate('/reminders');
      await mutate('/calendar/events');
      setShowReminderModal(false);
    } catch (e) {
      console.error('Failed to create reminder', e);
    }
  }

  // ── Schedule CRUD ──────────────────────────────────────────────────
  useEffect(() => {
    async function loadSchedules() {
      setSchedulesLoading(true);
      try {
        const { getCalendarSchedules } = await import('@/lib/api');
        const data = await getCalendarSchedules();
        setSchedules(data);
      } catch (e) {
        console.error('Failed to load schedules', e);
      } finally {
        setSchedulesLoading(false);
      }
    }
    loadSchedules();
  }, []);

  const schedulesByDay = useMemo(() => {
    const map = new Map<string, CalendarSchedule[]>();
    for (const s of schedules) {
      const key = s.schedule_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [schedules]);

  const selectedSchedules = selectedDateKey ? schedulesByDay.get(selectedDateKey) ?? [] : [];

  function openNewSchedule() {
    if (!selectedDate) return;
    setEditingSchedule(null);
    setScheduleTitle('');
    setScheduleDescription('');
    setScheduleDate(formatDateKey(selectedDate));
    setScheduleTime('');
    setScheduleEndTime('');
    setScheduleIsAllDay(false);
    setScheduleColor('#f59e0b');
    setShowScheduleEditor(true);
  }

  function openEditSchedule(schedule: CalendarSchedule) {
    setEditingSchedule(schedule);
    setScheduleTitle(schedule.title);
    setScheduleDescription(schedule.description);
    setScheduleDate(schedule.schedule_date);
    setScheduleTime(schedule.schedule_time?.slice(0, 5) ?? '');
    setScheduleEndTime(schedule.end_time?.slice(0, 5) ?? '');
    setScheduleIsAllDay(schedule.is_all_day);
    setScheduleColor(schedule.color);
    setShowScheduleEditor(true);
  }

  function handleSaveSchedule() {
    if (!scheduleTitle.trim() || !scheduleDate) return;
    setOtpModal({
      open: true,
      title: editingSchedule ? 'Edit Schedule' : 'Save Schedule',
      description: `You are about to ${editingSchedule ? 'edit' : 'create'} the schedule "${scheduleTitle.trim()}" on ${scheduleDate}. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'scheduleSave',
    });
  }

  async function handleScheduleSaveVerified(actionToken: string) {
    if (!scheduleTitle.trim() || !scheduleDate) return;
    setSavingSchedule(true);
    try {
      const data: any = {
        title: scheduleTitle.trim(),
        description: scheduleDescription,
        schedule_date: scheduleDate,
        is_all_day: scheduleIsAllDay,
        color: scheduleColor,
        action_token: actionToken,
      };
      if (scheduleTime) data.schedule_time = scheduleTime;
      if (scheduleEndTime) data.end_time = scheduleEndTime;

      if (editingSchedule) {
        await updateCalendarSchedule(editingSchedule.id, data);
      } else {
        await createCalendarSchedule(data);
      }
      // Reload schedules
      const { getCalendarSchedules } = await import('@/lib/api');
      const updated = await getCalendarSchedules();
      setSchedules(updated);
      await mutate('/calendar/events');
      setShowScheduleEditor(false);
    } catch (e) {
      console.error('Failed to save schedule', e);
    } finally {
      setSavingSchedule(false);
    }
  }

  function handleDeleteSchedule(scheduleId: string) {
    const schedule = schedules.find((s) => s.id === scheduleId);
    setOtpModal({
      open: true,
      title: 'Delete Schedule',
      description: `You are about to delete the schedule "${schedule?.title ?? scheduleId}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'scheduleDelete',
    });
    (window as any).__pendingScheduleDelete = scheduleId;
  }

  async function handleScheduleDeleteVerified(actionToken: string) {
    const scheduleId = (window as any).__pendingScheduleDelete;
    if (!scheduleId) return;
    try {
      await deleteCalendarSchedule(scheduleId, actionToken);
      const { getCalendarSchedules } = await import('@/lib/api');
      const updated = await getCalendarSchedules();
      setSchedules(updated);
      await mutate('/calendar/events');
      (window as any).__pendingScheduleDelete = null;
    } catch (e) {
      console.error('Failed to delete schedule', e);
    }
  }

  // ── Updated OTP handler ────────────────────────────────────────────
  function handleOtpVerified(actionToken: string) {
    if (otpModal.pendingAction === 'save') handleSaveVerified(actionToken);
    else if (otpModal.pendingAction === 'delete') handleDeleteVerified(actionToken);
    else if (otpModal.pendingAction === 'stageAdvance') executeStageAdvance(actionToken);
    else if (otpModal.pendingAction === 'telegramNotify') executeTelegramNotify(actionToken);
    else if (otpModal.pendingAction === 'scheduleSave') handleScheduleSaveVerified(actionToken);
    else if (otpModal.pendingAction === 'scheduleDelete') handleScheduleDeleteVerified(actionToken);
  }

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
            Synced events from orders, stage updates, reminders, deliveries & manual notes
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

      {isLoading && events.length === 0 && notesLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
          Loading calendar…
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
                const dayNotes = notesByDay.get(key) ?? [];
                const daySchedules = schedulesByDay.get(key) ?? [];
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

                    {/* Event dots + Note dots + Schedule dots */}
                    {(dayEvents.length > 0 || dayNotes.length > 0 || daySchedules.length > 0) && (
                      <div className="mt-auto flex w-full flex-wrap gap-1 pt-1">
                        {/* Note dots (shown as small squares) */}
                        {dayNotes.slice(0, 2).map((n, i) => (
                          <span
                            key={`note-${i}`}
                            className="inline-block h-1.5 w-1.5 rounded-sm"
                            style={{ backgroundColor: n.color }}
                            title={`Note: ${n.title}`}
                          />
                        ))}
                        {/* Schedule dots (shown as small squares with amber color) */}
                        {daySchedules.slice(0, Math.max(0, 2 - dayNotes.length)).map((s, i) => (
                          <span
                            key={`sched-${i}`}
                            className="inline-block h-1.5 w-1.5 rounded-sm"
                            style={{ backgroundColor: s.color }}
                            title={`Schedule: ${s.title}`}
                          />
                        ))}
                        {/* Event dots (shown as circles) */}
                        {dayEvents.slice(0, Math.max(0, 4 - dayNotes.length - daySchedules.length)).map((e, i) => (
                          <span
                            key={`evt-${i}`}
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: e.color }}
                            title={e.category}
                          />
                        ))}
                        {(dayEvents.length + dayNotes.length + daySchedules.length) > 4 && (
                          <span className="text-[10px] leading-3 text-gray-400">
                            +{dayEvents.length + dayNotes.length + daySchedules.length - 4}
                          </span>
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
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-gray-800 truncate">
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
                    {selectedEvents.length + selectedNotes.length + selectedSchedules.length} item{selectedEvents.length + selectedNotes.length + selectedSchedules.length !== 1 ? 's' : ''}
                  </p>
                </div>
                {selectedDate && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={openTelegramNotify}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-orange-500"
                      title="Notify Telegram"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                    <button
                      onClick={openNewSchedule}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-amber-500"
                      title="Add schedule"
                    >
                      <CalendarDays className="h-4 w-4" />
                    </button>
                    <button
                      onClick={openNewNote}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[#2490ef]"
                      title="Add note"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {selectedEvents.length === 0 && selectedNotes.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                  <CalendarIcon className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">No events for this day</p>
                  {selectedDate && (
                    <button
                      onClick={openNewNote}
                      className="mt-3 flex items-center gap-1.5 rounded-lg bg-[#2490ef] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1c7ad4]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add a note
                    </button>
                  )}
                </div>
              )}

              {/* Notes section */}
              {selectedNotes.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-1">
                    Notes ({selectedNotes.length})
                  </p>
                  {selectedNotes.map((note) => (
                    <div
                      key={note.id}
                      className="group rounded-lg border border-gray-100 p-3 hover:border-gray-200"
                      style={{ borderLeftColor: note.color, borderLeftWidth: 3 }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800 truncate">{note.title}</p>
                          {note.content && (
                            <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap line-clamp-3">{note.content}</p>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openEditNote(note)}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                            title="Edit note"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => handleDeleteNote(note.id)}
                            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                            title="Delete note"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1.5">
                        <StickyNote className="h-3 w-3 inline mr-0.5" />
                        Manual note
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Schedules section */}
              {selectedSchedules.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-1">
                    Schedules ({selectedSchedules.length})
                  </p>
                  {selectedSchedules.map((schedule) => (
                    <div
                      key={schedule.id}
                      className="group rounded-lg border border-gray-100 p-3 hover:border-gray-200"
                      style={{ borderLeftColor: schedule.color, borderLeftWidth: 3 }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800 truncate">{schedule.title}</p>
                          {schedule.description && (
                            <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap line-clamp-3">{schedule.description}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1.5">
                            {schedule.schedule_time && (
                              <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                                <Clock className="h-3 w-3" />
                                {schedule.schedule_time?.slice(0, 5)}
                                {schedule.end_time ? ` - ${schedule.end_time?.slice(0, 5)}` : ''}
                              </span>
                            )}
                            {schedule.is_all_day && (
                              <span className="text-[10px] text-gray-400">All day</span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openEditSchedule(schedule)}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                            title="Edit schedule"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => handleDeleteSchedule(schedule.id)}
                            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                            title="Delete schedule"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1.5">
                        <CalendarDays className="h-3 w-3 inline mr-0.5" />
                        Schedule
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Events section */}
              {selectedEvents.length > 0 && (
                <div className="space-y-1.5">
                  {selectedNotes.length > 0 && (
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-1 pt-2">
                      System Events ({selectedEvents.length})
                    </p>
                  )}
                  {selectedEvents.map((event) => {
                    const stageActions = event.metadata ? STAGE_ADVANCE_ACTIONS[event.metadata] : undefined;
                    const hasOrderRef = event.title && event.title !== 'Unknown';
                    return (
                      <div
                        key={`${event.type}-${event.event_id}`}
                        className={`rounded-lg border border-gray-100 bg-gray-50 p-3 ${hasOrderRef ? 'cursor-pointer hover:bg-gray-100' : ''}`}
                      >
                        <div
                          onClick={() => hasOrderRef && navigateToOrder(event)}
                          className="flex items-start gap-2"
                        >
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

                        {/* Action buttons */}
                        {hasOrderRef && (
                          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-gray-200 pt-2">
                            {stageActions && stageActions.map((action) => (
                              <button
                                key={action.stage}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStageAdvance(event, action.stage, action.label);
                                }}
                                className="flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[10px] font-medium text-gray-600 shadow-sm ring-1 ring-gray-200 hover:bg-[#2490ef] hover:text-white hover:ring-[#2490ef] transition-colors"
                              >
                                {action.icon}
                                {action.label}
                              </button>
                            ))}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openReminderModal(event);
                              }}
                              className="flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[10px] font-medium text-gray-600 shadow-sm ring-1 ring-gray-200 hover:bg-amber-50 hover:text-amber-600 hover:ring-amber-300 transition-colors"
                            >
                              <Bell className="h-3 w-3" />
                              Remind
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
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
                  { type: 'deposit', label: 'Deposit Paid', color: '#10b981' },
                  { type: 'balance', label: 'Balance Paid', color: '#06b6d4' },
                  { type: 'production_start', label: 'Production Start', color: '#a855f7' },
                  { type: 'production_finish', label: 'Production Finish', color: '#6366f1' },
                  { type: 'en_route', label: 'En Route', color: '#14b8a6' },
                  { type: 'order_confirmed', label: 'Order Confirmed', color: '#84cc16' },
                  { type: 'schedule', label: 'Schedule', color: '#f59e0b' },
                  { type: 'note', label: 'Manual Note', color: '#10b981' },
                ].map((item) => (
                  <div key={item.type} className="flex items-center gap-1.5">
                    <span
                      className={`inline-block h-2 w-2 ${item.type === 'note' ? 'rounded-sm' : 'rounded-full'}`}
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

      {/* Note Editor Modal */}
      {showNoteEditor && selectedDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h3 className="text-sm font-semibold text-gray-800">
                {editingNote ? 'Edit Note' : 'Add Note'}
              </h3>
              <button
                onClick={() => setShowNoteEditor(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                <p className="text-sm text-gray-800">
                  {selectedDate.toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>

              <div>
                <label htmlFor="note-title" className="block text-xs font-medium text-gray-600 mb-1">
                  Title *
                </label>
                <input
                  id="note-title"
                  type="text"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="e.g., Client follow-up"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none placeholder:text-gray-400 focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                  maxLength={200}
                />
              </div>

              <div>
                <label htmlFor="note-content" className="block text-xs font-medium text-gray-600 mb-1">
                  Content (optional)
                </label>
                <textarea
                  id="note-content"
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Add details about this note..."
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none placeholder:text-gray-400 focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef] resize-none"
                  rows={3}
                  maxLength={2000}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Color</label>
                <div className="flex flex-wrap gap-2">
                  {NOTE_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setNoteColor(c)}
                      className={`h-7 w-7 rounded-lg transition-transform ${
                        noteColor === c ? 'scale-110 ring-2 ring-offset-1 ring-gray-400' : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
              {editingNote ? (
                <button
                  onClick={() => handleDeleteNote(editingNote.id)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowNoteEditor(false)}
                  className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveNote}
                  disabled={!noteTitle.trim() || savingNote}
                  className="rounded-lg bg-[#2490ef] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#1c7ad4] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingNote ? 'Saving…' : editingNote ? 'Update' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Editor Modal */}
      {showScheduleEditor && selectedDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h3 className="text-sm font-semibold text-gray-800">
                {editingSchedule ? 'Edit Schedule' : 'Add Schedule'}
              </h3>
              <button
                onClick={() => setShowScheduleEditor(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <label htmlFor="schedule-title" className="block text-xs font-medium text-gray-600 mb-1">
                  Title *
                </label>
                <input
                  id="schedule-title"
                  type="text"
                  value={scheduleTitle}
                  onChange={(e) => setScheduleTitle(e.target.value)}
                  placeholder="e.g., Team meeting"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none placeholder:text-gray-400 focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                  maxLength={200}
                />
              </div>

              <div>
                <label htmlFor="schedule-desc" className="block text-xs font-medium text-gray-600 mb-1">
                  Description (optional)
                </label>
                <textarea
                  id="schedule-desc"
                  value={scheduleDescription}
                  onChange={(e) => setScheduleDescription(e.target.value)}
                  placeholder="Add details about this schedule..."
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none placeholder:text-gray-400 focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef] resize-none"
                  rows={2}
                  maxLength={2000}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="schedule-date" className="block text-xs font-medium text-gray-600 mb-1">
                    Date *
                  </label>
                  <input
                    id="schedule-date"
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                  />
                </div>
                <div>
                  <label htmlFor="schedule-time" className="block text-xs font-medium text-gray-600 mb-1">
                    Start time
                  </label>
                  <input
                    id="schedule-time"
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    disabled={scheduleIsAllDay}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef] disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="schedule-endtime" className="block text-xs font-medium text-gray-600 mb-1">
                    End time
                  </label>
                  <input
                    id="schedule-endtime"
                    type="time"
                    value={scheduleEndTime}
                    onChange={(e) => setScheduleEndTime(e.target.value)}
                    disabled={scheduleIsAllDay}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef] disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={scheduleIsAllDay}
                      onChange={(e) => setScheduleIsAllDay(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-[#2490ef] focus:ring-[#2490ef]"
                    />
                    <span className="text-xs font-medium text-gray-600">All day</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Color</label>
                <div className="flex flex-wrap gap-2">
                  {NOTE_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setScheduleColor(c)}
                      className={`h-7 w-7 rounded-lg transition-transform ${
                        scheduleColor === c ? 'scale-110 ring-2 ring-offset-1 ring-gray-400' : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
              {editingSchedule ? (
                <button
                  onClick={() => handleDeleteSchedule(editingSchedule.id)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowScheduleEditor(false)}
                  className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveSchedule}
                  disabled={!scheduleTitle.trim() || !scheduleDate || savingSchedule}
                  className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingSchedule ? 'Saving…' : editingSchedule ? 'Update' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Telegram Notification Modal */}
      {showTelegramNotify && selectedDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h3 className="text-sm font-semibold text-gray-800">Notify Telegram Group</h3>
              <button
                onClick={() => setShowTelegramNotify(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                <p className="text-sm text-gray-800">
                  {selectedDate.toLocaleDateString('en-US', {
                    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
                  })}
                </p>
              </div>

              <div>
                <label htmlFor="tg-message" className="block text-xs font-medium text-gray-600 mb-1">
                  Message *
                </label>
                <textarea
                  id="tg-message"
                  value={telegramMessage}
                  onChange={(e) => setTelegramMessage(e.target.value)}
                  placeholder="Type the notification message to send to the escalation group..."
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none placeholder:text-gray-400 focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef] resize-none"
                  rows={4}
                  maxLength={2000}
                />
                <p className="mt-1 text-xs text-gray-400">
                  This will be sent to the escalation Telegram group with a calendar context header.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
              <button
                onClick={() => setShowTelegramNotify(false)}
                className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSendTelegramNotify}
                disabled={!telegramMessage.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="h-3.5 w-3.5" />
                Send Notification
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reminder Creation Modal */}
      {showReminderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h3 className="text-sm font-semibold text-gray-800">Create Reminder</h3>
              <button
                onClick={() => setShowReminderModal(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Order ID</label>
                <p className="text-sm text-gray-800 font-mono text-xs break-all">{reminderOrderId}</p>
              </div>

              <div>
                <label htmlFor="reminder-stage" className="block text-xs font-medium text-gray-600 mb-1">
                  Stage
                </label>
                <input
                  id="reminder-stage"
                  type="text"
                  value={reminderStage}
                  onChange={(e) => setReminderStage(e.target.value)}
                  placeholder="e.g., delivery_pending"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none placeholder:text-gray-400 focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                />
              </div>

              <div>
                <label htmlFor="reminder-msg" className="block text-xs font-medium text-gray-600 mb-1">
                  Reminder Message *
                </label>
                <textarea
                  id="reminder-msg"
                  value={reminderMessage}
                  onChange={(e) => setReminderMessage(e.target.value)}
                  placeholder="What should the reminder say?"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none placeholder:text-gray-400 focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef] resize-none"
                  rows={2}
                  maxLength={500}
                />
              </div>

              <div>
                <label htmlFor="reminder-freq" className="block text-xs font-medium text-gray-600 mb-1">
                  Frequency
                </label>
                <select
                  id="reminder-freq"
                  value={reminderFrequency}
                  onChange={(e) => setReminderFrequency(e.target.value as 'hourly' | 'daily' | 'once')}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                >
                  <option value="daily">Daily</option>
                  <option value="hourly">Hourly</option>
                  <option value="once">Once</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
              <button
                onClick={() => setShowReminderModal(false)}
                className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateReminder}
                disabled={!reminderMessage.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Bell className="h-3.5 w-3.5" />
                Create Reminder
              </button>
            </div>
          </div>
        </div>
      )}

      <OtpModal
        open={otpModal.open}
        title={otpModal.title}
        description={otpModal.description}
        onVerified={handleOtpVerified}
        onClose={() => {
          setOtpModal({ ...otpModal, open: false });
          (window as any).__pendingNoteData = null;
          (window as any).__pendingNoteDelete = null;
          setPendingStageAdvance(null);
        }}
      />
    </div>
  );
}
