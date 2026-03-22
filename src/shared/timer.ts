import type {
  CountdownStartPayload,
  CountdownState,
} from './contracts';

export const WINDOW_SIZE = { width: 980, height: 700 };

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MAX_TIMER_DELAY = 2_147_483_647;

export const TIMER_COMPLETION_BODY = 'Time is up.';

function isValidTimerMode(mode: string): mode is CountdownState['mode'] {
  return mode === 'duration' || mode === 'datetime';
}

function sanitizeDurationMs(durationMs: number | undefined) {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return undefined;
  }

  return durationMs;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function durationToMs(hours: number, minutes: number): number {
  const safeHours = Math.max(0, Math.floor(hours));
  const safeMinutes = Math.max(0, Math.floor(minutes));

  return (safeHours * MS_PER_HOUR) + (safeMinutes * MS_PER_MINUTE);
}

export function buildDurationPayload(
  hours: number,
  minutes: number,
  nowMs: number,
): CountdownStartPayload {
  const durationMs = durationToMs(hours, minutes);

  return {
    mode: 'duration',
    durationMs,
    targetAt: new Date(nowMs + durationMs).toISOString(),
  };
}

export function hydrateStoredCountdownState(
  state: CountdownState | null,
  nowMs = Date.now(),
): CountdownState | null {
  if (!state) {
    return null;
  }

  if (!isValidTimerMode(state.mode)) {
    return null;
  }

  const targetMs = Date.parse(state.targetAt);
  const startedMs = Date.parse(state.startedAt);

  if (Number.isNaN(targetMs) || Number.isNaN(startedMs)) {
    return null;
  }

  const sanitizedState = {
    ...state,
    durationMs: sanitizeDurationMs(state.durationMs),
  };

  if (sanitizedState.completed || targetMs <= nowMs) {
    return { ...sanitizedState, completed: true };
  }

  return { ...sanitizedState, completed: false };
}

export function getCountdownMetrics(
  state: CountdownState | null,
  nowMs = Date.now(),
): {
  remainingMs: number;
  elapsedMs: number;
  totalMs: number;
  progress: number;
  completed: boolean;
} {
  if (!state) {
    return {
      remainingMs: 0,
      elapsedMs: 0,
      totalMs: 0,
      progress: 0,
      completed: false,
    };
  }

  const targetMs = Date.parse(state.targetAt);

  if (Number.isNaN(targetMs)) {
    return {
      remainingMs: 0,
      elapsedMs: 0,
      totalMs: 0,
      progress: 0,
      completed: false,
    };
  }

  const startedMs = Date.parse(state.startedAt);
  const remainingMs = Math.max(0, targetMs - nowMs);
  const totalMs = sanitizeDurationMs(state.durationMs)
    ?? (!Number.isNaN(startedMs) ? Math.max(0, targetMs - startedMs) : remainingMs);
  const elapsedMs = clampNumber(totalMs - remainingMs, 0, totalMs || 0);
  const progress = totalMs > 0 ? clampNumber(elapsedMs / totalMs, 0, 1) : 0;
  const completed = state.completed || remainingMs <= 0;

  return {
    remainingMs,
    elapsedMs,
    totalMs,
    progress: completed && totalMs > 0 ? 1 : progress,
    completed,
  };
}

export function getTimerDelayMs(
  state: CountdownState | null,
  nowMs = Date.now(),
): number | null {
  if (!state) {
    return null;
  }

  const targetMs = Date.parse(state.targetAt);

  if (Number.isNaN(targetMs)) {
    return null;
  }

  const remainingMs = targetMs - nowMs;

  if (remainingMs <= 0) {
    return 0;
  }

  return Math.min(remainingMs, MAX_TIMER_DELAY);
}

export function getNotificationBody(): string {
  return TIMER_COMPLETION_BODY;
}

export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / MS_PER_SECOND));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours.toString().padStart(2, '0')}h`;
  }

  if (hours > 0) {
    return [
      hours.toString().padStart(2, '0'),
      minutes.toString().padStart(2, '0'),
      seconds.toString().padStart(2, '0'),
    ].join(':');
  }

  return [
    minutes.toString().padStart(2, '0'),
    seconds.toString().padStart(2, '0'),
  ].join(':');
}

export function describeDuration(ms: number): string {
  if (ms <= 0) {
    return '0m';
  }

  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes}m`);
  }

  return parts.slice(0, 2).join(' ');
}

export function formatEditorialTarget(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function isValidStartPayload(payload: CountdownStartPayload): boolean {
  const targetMs = Date.parse(payload.targetAt);

  if (Number.isNaN(targetMs)) {
    return false;
  }

  if (payload.mode === 'duration') {
    return typeof payload.durationMs === 'number' && payload.durationMs > 0;
  }

  return payload.mode === 'datetime';
}
