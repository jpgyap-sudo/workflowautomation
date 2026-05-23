const DEFAULT_TIME_ZONE = 'Asia/Singapore';

type TimestampVariant = 'date' | 'datetime' | 'relative' | 'compact';

interface TimestampProps {
  value?: string | number | Date | null;
  variant?: TimestampVariant;
  label?: string;
  empty?: string;
  className?: string;
}

function toDate(value?: string | number | Date | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTimestamp(
  value?: string | number | Date | null,
  variant: TimestampVariant = 'datetime',
): string {
  const date = toDate(value);
  if (!date) return '—';

  if (variant === 'relative') return formatRelativeTimestamp(date);

  const dateStyle: Intl.DateTimeFormatOptions['dateStyle'] =
    variant === 'compact' ? 'medium' : 'medium';
  const timeStyle: Intl.DateTimeFormatOptions['timeStyle'] =
    variant === 'date' ? undefined : variant === 'compact' ? 'short' : 'short';

  return new Intl.DateTimeFormat('en-SG', {
    dateStyle,
    timeStyle,
    timeZone: DEFAULT_TIME_ZONE,
  }).format(date);
}

export function formatRelativeTimestamp(value?: string | number | Date | null): string {
  const date = toDate(value);
  if (!date) return '—';

  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  const rtf = new Intl.RelativeTimeFormat('en-SG', { numeric: 'auto' });
  for (const [unit, seconds] of units) {
    if (absSeconds >= seconds) return rtf.format(Math.round(diffSeconds / seconds), unit);
  }
  return rtf.format(diffSeconds, 'second');
}

export default function Timestamp({
  value,
  variant = 'datetime',
  label,
  empty = '—',
  className = '',
}: TimestampProps) {
  const date = toDate(value);
  if (!date) return <span className={className}>{label ? `${label}: ${empty}` : empty}</span>;

  const full = formatTimestamp(date, 'datetime');
  const text = formatTimestamp(date, variant);

  return (
    <time dateTime={date.toISOString()} title={`${full} (${DEFAULT_TIME_ZONE})`} className={className}>
      {label ? `${label}: ${text}` : text}
      {variant !== 'relative' && (
        <span className="ml-1 text-gray-400">({formatRelativeTimestamp(date)})</span>
      )}
    </time>
  );
}
