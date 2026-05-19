/**
 * Philippines timezone (UTC+8) date formatting utilities.
 * All dashboard dates should use these helpers so timestamps
 * are consistently displayed in Philippines time (PHT/UTC+8).
 */

const PHT_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

const PHT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

const PHT_FULL_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'long',
};

/**
 * Format an ISO date string to Philippines time with date + time.
 * Example: "May 20, 2026, 01:15 AM"
 */
export function formatPHT(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-PH', PHT_OPTIONS);
  } catch {
    return iso;
  }
}

/**
 * Format an ISO date string to Philippines time with date only.
 * Example: "May 20, 2026"
 */
export function formatPHTDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-PH', PHT_DATE_OPTIONS);
  } catch {
    return iso;
  }
}

/**
 * Format an ISO date string to Philippines time with full date + time.
 * Example: "Tuesday, May 20, 2026, 01:15 AM"
 */
export function formatPHTFull(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-PH', PHT_FULL_OPTIONS);
  } catch {
    return iso;
  }
}

/**
 * Show a human-readable "time ago" string relative to Philippines time.
 * Uses the same logic but offsets to PHT for display purposes.
 */
export function timeAgoPHT(iso: string): string {
  try {
    const now = new Date();
    // Convert both to Philippines time for comparison
    const nowPHT = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    const datePHT = new Date(
      new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Manila' })
    );
    const diff = nowPHT.getTime() - datePHT.getTime();

    if (diff < 60_000) return 'Just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
    return formatPHTDate(iso);
  } catch {
    return iso;
  }
}
