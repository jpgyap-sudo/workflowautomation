'use client';

import { useMemo, useState, useCallback } from 'react';
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
} from 'lucide-react';
import { useCalendarEvents, useCalendarNotes } from '@/lib/useApi';
import { CalendarEvent, CalendarNote, createCalendarNote, updateCalendarNote, deleteCalendarNote } from '@/lib/api';
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
    open: boolean; title: string; description: string; pendingAction: 'save' | 'delete';
  }>({ open: false, title: '', description: '', pendingAction: 'save' });



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
          note_date: formatDateKey(selectedDate), title: noteTitle.trim(), content: noteContent, color: noteColor,
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

  function handleOtpVerified(actionToken: string) {
    if (otpModal.pendingAction === 'save') handleSaveVerified(actionToken);
    else handleDeleteVerified(actionToken);
  }

  function navigateToOrder(event: CalendarEvent) {
    if (event.title && event.title !== 'Unknown') {
      router.push(`/orders/${encodeURIComponent(event.title)}`);
    }
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

                    {/* Event dots + Note dots */}
                    {(dayEvents.length > 0 || dayNotes.length > 0) && (
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
                        {/* Event dots (shown as circles) */}
                        {dayEvents.slice(0, Math.max(0, 4 - dayNotes.length)).map((e, i) => (
                          <span
                            key={`evt-${i}`}
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: e.color }}
                            title={e.category}
                          />
                        ))}
                        {(dayEvents.length + dayNotes.length) > 4 && (
                          <span className="text-[10px] leading-3 text-gray-400">
                            +{dayEvents.length + dayNotes.length - 4}
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
                    {selectedEvents.length + selectedNotes.length} item{selectedEvents.length + selectedNotes.length !== 1 ? 's' : ''}
                  </p>
                </div>
                {selectedDate && (
                  <button
                    onClick={openNewNote}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[#2490ef]"
                    title="Add note"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
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

              {/* Events section */}
              {selectedEvents.length > 0 && (
                <div className="space-y-1.5">
                  {selectedNotes.length > 0 && (
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-1 pt-2">
                      System Events ({selectedEvents.length})
                    </p>
                  )}
                  {selectedEvents.map((event) => (
                    <div
                      key={`${event.type}-${event.event_id}`}
                      onClick={() => navigateToOrder(event)}
                      className={`rounded-lg border border-gray-100 bg-gray-50 p-3 ${event.title && event.title !== 'Unknown' ? 'cursor-pointer hover:bg-gray-100' : ''}`}
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

      <OtpModal
        open={otpModal.open}
        title={otpModal.title}
        description={otpModal.description}
        onVerified={handleOtpVerified}
        onClose={() => {
          setOtpModal({ ...otpModal, open: false });
          (window as any).__pendingNoteData = null;
          (window as any).__pendingNoteDelete = null;
        }}
      />
    </div>
  );
}
