import { addDays, endOfDay, format, parseISO, startOfDay, subDays } from 'date-fns';
import type { DateRange } from './types.js';

export interface RangeOptions {
  date?: string;
  since?: string;
  until?: string;
  today?: boolean;
  weekendSkip?: boolean;
  now?: Date;
}

export function resolveRange(opts: RangeOptions): DateRange {
  const now = opts.now ?? new Date();

  if (opts.today) {
    return {
      since: startOfDay(now),
      until: endOfDay(now),
      label: format(now, 'yyyy-MM-dd'),
    };
  }

  if (opts.since || opts.until) {
    const since = opts.since ? startOfDay(parseISO(opts.since)) : startOfDay(subDays(now, 1));
    const until = opts.until ? endOfDay(parseISO(opts.until)) : endOfDay(now);
    return {
      since,
      until,
      label: `${format(since, 'yyyy-MM-dd')}..${format(until, 'yyyy-MM-dd')}`,
    };
  }

  if (opts.date) {
    const d = parseISO(opts.date);
    return {
      since: startOfDay(d),
      until: endOfDay(d),
      label: format(d, 'yyyy-MM-dd'),
    };
  }

  const target = smartYesterday(now, opts.weekendSkip ?? true);
  return {
    since: startOfDay(target),
    until: endOfDay(target),
    label: format(target, 'yyyy-MM-dd'),
  };
}

export function smartYesterday(now: Date, weekendSkip: boolean): Date {
  if (!weekendSkip) return subDays(now, 1);
  const dow = now.getDay();
  if (dow === 1) return subDays(now, 3);
  if (dow === 0) return subDays(now, 2);
  if (dow === 6) return subDays(now, 1);
  return subDays(now, 1);
}

export function rangeContains(r: DateRange, iso: string): boolean {
  const t = parseISO(iso).getTime();
  return t >= r.since.getTime() && t <= r.until.getTime();
}

export function shiftDay(d: Date, by: number): Date {
  return addDays(d, by);
}
