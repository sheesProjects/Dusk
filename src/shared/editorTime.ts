export type Meridiem = 'AM' | 'PM';
export type ExactField = 'month' | 'day' | 'year' | 'hour' | 'minute';

export type ExactDateInput = {
  month: string;
  day: string;
  year: string;
  hour: string;
  minute: string;
  period: Meridiem;
};

export type DurationInput = {
  durationHours: string;
  durationMinutes: string;
};

export const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export const MIN_EDITOR_YEAR = 2024;
export const MAX_EDITOR_YEAR = 2099;

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function toExactParts(date: Date): ExactDateInput {
  const hours24 = date.getHours();
  const period: Meridiem = hours24 >= 12 ? 'PM' : 'AM';
  const hour12 = hours24 % 12 || 12;

  return {
    month: `${date.getMonth() + 1}`.padStart(2, '0'),
    day: `${date.getDate()}`.padStart(2, '0'),
    year: `${date.getFullYear()}`,
    hour: `${hour12}`.padStart(2, '0'),
    minute: `${date.getMinutes()}`.padStart(2, '0'),
    period,
  };
}

export function buildExactDate(input: ExactDateInput): Date | null {
  const month = Number.parseInt(input.month, 10);
  const day = Number.parseInt(input.day, 10);
  const year = Number.parseInt(input.year, 10);
  const hour12 = Number.parseInt(input.hour, 10);
  const minute = Number.parseInt(input.minute, 10);

  if (
    !Number.isInteger(month)
    || !Number.isInteger(day)
    || !Number.isInteger(year)
    || !Number.isInteger(hour12)
    || !Number.isInteger(minute)
  ) {
    return null;
  }

  if (
    month < 1
    || month > 12
    || day < 1
    || day > 31
    || year < MIN_EDITOR_YEAR
    || year > MAX_EDITOR_YEAR
    || hour12 < 1
    || hour12 > 12
    || minute < 0
    || minute > 59
  ) {
    return null;
  }

  const hour24 = input.period === 'PM' ? (hour12 % 12) + 12 : hour12 % 12;
  const target = new Date(year, month - 1, day, hour24, minute, 0, 0);

  if (
    target.getFullYear() !== year
    || target.getMonth() !== month - 1
    || target.getDate() !== day
    || target.getHours() !== hour24
    || target.getMinutes() !== minute
  ) {
    return null;
  }

  return target;
}

export function shiftExactDate(date: Date, field: ExactField, delta: number): Date {
  const next = new Date(date.getTime());

  if (field === 'day') {
    next.setDate(next.getDate() + delta);
  }

  if (field === 'hour') {
    next.setHours(next.getHours() + delta);
  }

  if (field === 'minute') {
    next.setMinutes(next.getMinutes() + delta);
  }

  if (field === 'month') {
    const currentDay = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + delta);
    next.setDate(Math.min(currentDay, daysInMonth(next.getFullYear(), next.getMonth() + 1)));
  }

  if (field === 'year') {
    const currentDay = next.getDate();
    const targetYear = Math.max(MIN_EDITOR_YEAR, Math.min(MAX_EDITOR_YEAR, next.getFullYear() + delta));
    const month = next.getMonth() + 1;
    next.setDate(1);
    next.setFullYear(targetYear);
    next.setDate(Math.min(currentDay, daysInMonth(targetYear, month)));
  }

  return next;
}

export function getDurationMinutes(input: DurationInput): number {
  const hours = Number.parseInt(input.durationHours || '0', 10);
  const minutes = Number.parseInt(input.durationMinutes || '0', 10);

  return Math.max(0, (Number.isNaN(hours) ? 0 : hours * 60) + (Number.isNaN(minutes) ? 0 : minutes));
}

export function toDurationParts(totalMinutes: number): DurationInput {
  const clamped = Math.max(0, Math.min(totalMinutes, 999 * 60 + 59));

  return {
    durationHours: `${Math.floor(clamped / 60)}`,
    durationMinutes: `${clamped % 60}`.padStart(2, '0'),
  };
}
