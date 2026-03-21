import { useEffect, useMemo, useRef, useState } from 'react';

import type { CountdownState, TimerMode } from '../shared/contracts';
import {
  buildDurationPayload,
  formatCountdown,
  getCountdownMetrics,
} from '../shared/timer';

type Meridiem = 'AM' | 'PM';
type ExactField = 'month' | 'day' | 'year' | 'hour' | 'minute';

type FormState = {
  mode: TimerMode;
  durationHours: string;
  durationMinutes: string;
  month: string;
  day: string;
  year: string;
  hour: string;
  minute: string;
  period: Meridiem;
};

type PreviewState = {
  tone: 'normal' | 'error';
  kicker: string;
  title: string;
  detail: string;
};

type ScrubCardProps = {
  label: string;
  value: string;
  previousValue: string;
  nextValue: string;
  onStep: (delta: number) => void;
  accent?: 'warm' | 'cool';
};

const PRESET_ACTIONS = [
  { label: '30m', hours: 0, minutes: 30 },
  { label: '1h', hours: 1, minutes: 0 },
  { label: '2h', hours: 2, minutes: 0 },
  { label: '4h', hours: 4, minutes: 0 },
] as const;

const MONTH_NAMES = [
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

const MIN_YEAR = 2024;
const MAX_YEAR = 2099;

function ScrubCard({
  label,
  value,
  previousValue,
  nextValue,
  onStep,
  accent = 'warm',
}: ScrubCardProps) {
  const dragStateRef = useRef<{ pointerId: number; clientY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const stepSizePx = 28;

  function finishDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      setIsDragging(false);

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }

  return (
    <div
      aria-label={`${label} picker`}
      aria-orientation="vertical"
      aria-valuetext={`${label} ${value}`}
      className={`scrub-card ${accent === 'cool' ? 'scrub-card-cool' : ''} ${isDragging ? 'is-dragging' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          onStep(1);
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          onStep(-1);
        }
      }}
      onPointerCancel={finishDrag}
      onPointerDown={(event) => {
        dragStateRef.current = {
          pointerId: event.pointerId,
          clientY: event.clientY,
        };
        setIsDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const dragState = dragStateRef.current;

        if (!dragState || dragState.pointerId !== event.pointerId) {
          return;
        }

        const delta = dragState.clientY - event.clientY;

        if (Math.abs(delta) < stepSizePx) {
          return;
        }

        const steps = Math.trunc(delta / stepSizePx);

        if (steps !== 0) {
          onStep(steps);
          dragStateRef.current = {
            ...dragState,
            clientY: dragState.clientY - (steps * stepSizePx),
          };
        }
      }}
      onPointerUp={finishDrag}
      onWheel={(event) => {
        event.preventDefault();
        onStep(event.deltaY > 0 ? 1 : -1);
      }}
      role="spinbutton"
      tabIndex={0}
    >
      <span className="stepper-label">{label}</span>
      <div className="scrub-track">
        <span className="scrub-preview">{previousValue}</span>
        <strong className="scrub-value">{value}</strong>
        <span className="scrub-preview">{nextValue}</span>
      </div>
    </div>
  );
}

function toExactParts(date: Date) {
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

function getFallbackTarget(nowMs = Date.now()) {
  const fallback = new Date(nowMs + 2 * 60 * 60 * 1000);
  fallback.setSeconds(0, 0);
  return fallback;
}

function buildFormState(countdown: CountdownState | null): FormState {
  const fallbackExact = toExactParts(getFallbackTarget());

  if (!countdown) {
    return {
      mode: 'duration',
      durationHours: '2',
      durationMinutes: '00',
      ...fallbackExact,
    };
  }

  const target = new Date(countdown.targetAt);
  const exact = toExactParts(target);
  const totalMinutes = Math.max(
    1,
    Math.round(
      (countdown.durationMs ?? Math.max(target.getTime() - Date.now(), 60_000)) / 60_000,
    ),
  );

  return {
    mode: countdown.mode,
    durationHours: `${Math.floor(totalMinutes / 60)}`,
    durationMinutes: `${totalMinutes % 60}`.padStart(2, '0'),
    ...exact,
  };
}

function buildExactDate(form: FormState): Date | null {
  const month = Number.parseInt(form.month, 10);
  const day = Number.parseInt(form.day, 10);
  const year = Number.parseInt(form.year, 10);
  const hour12 = Number.parseInt(form.hour, 10);
  const minute = Number.parseInt(form.minute, 10);

  if (
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(year) ||
    !Number.isInteger(hour12) ||
    !Number.isInteger(minute)
  ) {
    return null;
  }

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    year < MIN_YEAR ||
    year > MAX_YEAR ||
    hour12 < 1 ||
    hour12 > 12 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const hour24 = form.period === 'PM' ? (hour12 % 12) + 12 : hour12 % 12;
  const target = new Date(year, month - 1, day, hour24, minute, 0, 0);

  if (
    target.getFullYear() !== year ||
    target.getMonth() !== month - 1 ||
    target.getDate() !== day ||
    target.getHours() !== hour24 ||
    target.getMinutes() !== minute
  ) {
    return null;
  }

  return target;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function describeDuration(ms: number): string {
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

function formatEditorialTarget(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function shiftExactDate(form: FormState, field: ExactField, delta: number) {
  const next = getEditableExactDate(form);

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
    const targetYear = Math.max(MIN_YEAR, Math.min(MAX_YEAR, next.getFullYear() + delta));
    const month = next.getMonth() + 1;
    next.setDate(1);
    next.setFullYear(targetYear);
    next.setDate(Math.min(currentDay, daysInMonth(targetYear, month)));
  }

  return next;
}

function getEditableExactDate(form: FormState) {
  return buildExactDate(form) ?? getFallbackTarget();
}

function getDurationMinutes(form: FormState) {
  const hours = Number.parseInt(form.durationHours || '0', 10);
  const minutes = Number.parseInt(form.durationMinutes || '0', 10);

  return Math.max(0, (Number.isNaN(hours) ? 0 : hours * 60) + (Number.isNaN(minutes) ? 0 : minutes));
}

function toDurationParts(totalMinutes: number) {
  const clamped = Math.max(0, Math.min(totalMinutes, 999 * 60 + 59));

  return {
    durationHours: `${Math.floor(clamped / 60)}`,
    durationMinutes: `${clamped % 60}`.padStart(2, '0'),
  };
}

export function App() {
  const [countdown, setCountdown] = useState<CountdownState | null>(null);
  const [hasLoadedState, setHasLoadedState] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [form, setForm] = useState<FormState>(() => buildFormState(null));
  const isEditingRef = useRef(isEditing);

  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  useEffect(() => {
    let isMounted = true;

    void window.countdownWidget.getState().then((state) => {
      if (!isMounted) {
        return;
      }

      setCountdown(state);
      setForm(buildFormState(state));
      setIsEditing(!state);
      setHasLoadedState(true);
    });

    const removeTimerListener = window.countdownWidget.onTimerStateChanged((state) => {
      if (!isMounted) {
        return;
      }

      setCountdown(state);

      if (!state) {
        setIsEditing(true);
        setForm(buildFormState(null));
        return;
      }

      if (!isEditingRef.current) {
        setForm(buildFormState(state));
      }
    });

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      isMounted = false;
      removeTimerListener();
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedState) {
      return;
    }

    void window.countdownWidget.setEditingMode(isEditing);
  }, [hasLoadedState, isEditing]);

  const metrics = useMemo(() => getCountdownMetrics(countdown, now), [countdown, now]);

  const editorPreview = useMemo<PreviewState>(() => {
    if (form.mode === 'duration') {
      const durationMs = getDurationMinutes(form) * 60_000;

      if (durationMs <= 0) {
        return {
          tone: 'error',
          kicker: 'Duration',
          title: 'Set a duration',
          detail: 'Choose more than 0m.',
        };
      }

      const target = new Date(now + durationMs);

      return {
        tone: 'normal',
        kicker: 'Duration',
        title: describeDuration(durationMs),
        detail: `This lands ${formatEditorialTarget(target)}.`,
      };
    }

    const target = buildExactDate(form);

    if (!target) {
      return {
        tone: 'error',
        kicker: 'Exact Time',
        title: 'Invalid date',
        detail: 'Pick a future date and time.',
      };
    }

    const remainingMs = target.getTime() - now;

    if (remainingMs <= 0) {
      return {
        tone: 'error',
        kicker: 'Exact Time',
        title: 'Already passed',
        detail: 'Choose a future date and time.',
      };
    }

    return {
      tone: 'normal',
      kicker: 'Landing Time',
      title: formatEditorialTarget(target),
      detail: `${describeDuration(remainingMs)} total`,
    };
  }, [form, now]);

  const formattedCountdown = metrics.completed ? '00:00' : formatCountdown(metrics.remainingMs);
  const progressPercent = `${Math.round(metrics.progress * 100)}%`;
  const totalLabel = countdown ? describeDuration(metrics.totalMs) : 'Not set';
  const elapsedLabel = countdown ? describeDuration(metrics.elapsedMs) : '0m';
  const targetLabel = countdown ? formatEditorialTarget(new Date(countdown.targetAt)) : 'No target yet';
  const exactDate = getEditableExactDate(form);
  const exactMonthLabel = MONTH_NAMES[exactDate.getMonth()];
  const exactDayLabel = `${exactDate.getDate()}`.padStart(2, '0');
  const exactYearLabel = `${exactDate.getFullYear()}`;
  const exactHourLabel = `${Number.parseInt(form.hour, 10) || 12}`.padStart(2, '0');
  const exactMinuteLabel = `${exactDate.getMinutes()}`.padStart(2, '0');
  const currentDurationTotalMinutes = getDurationMinutes(form);
  const durationHoursLabel = `${Number.parseInt(form.durationHours || '0', 10) || 0}`.padStart(2, '0');
  const durationMinutesLabel = `${Number.parseInt(form.durationMinutes || '0', 10) || 0}`.padStart(2, '0');
  const durationHoursPrevious = toDurationParts(currentDurationTotalMinutes - 60).durationHours.padStart(2, '0');
  const durationHoursNext = toDurationParts(currentDurationTotalMinutes + 60).durationHours.padStart(2, '0');
  const durationMinutesPrevious = toDurationParts(currentDurationTotalMinutes - 5).durationMinutes;
  const durationMinutesNext = toDurationParts(currentDurationTotalMinutes + 5).durationMinutes;
  const previousMonthLabel = MONTH_NAMES[shiftExactDate(form, 'month', -1).getMonth()];
  const nextMonthLabel = MONTH_NAMES[shiftExactDate(form, 'month', 1).getMonth()];
  const previousDayLabel = `${shiftExactDate(form, 'day', -1).getDate()}`.padStart(2, '0');
  const nextDayLabel = `${shiftExactDate(form, 'day', 1).getDate()}`.padStart(2, '0');
  const previousYearLabel = `${shiftExactDate(form, 'year', -1).getFullYear()}`;
  const nextYearLabel = `${shiftExactDate(form, 'year', 1).getFullYear()}`;
  const previousHourDate = shiftExactDate(form, 'hour', -1);
  const nextHourDate = shiftExactDate(form, 'hour', 1);
  const previousHourLabel = `${previousHourDate.getHours() % 12 || 12}`.padStart(2, '0');
  const nextHourLabel = `${nextHourDate.getHours() % 12 || 12}`.padStart(2, '0');
  const previousMinuteLabel = `${shiftExactDate(form, 'minute', -1).getMinutes()}`.padStart(2, '0');
  const nextMinuteLabel = `${shiftExactDate(form, 'minute', 1).getMinutes()}`.padStart(2, '0');

  function closeEditor() {
    setIsEditing(false);
    setError(null);
  }

  function openEdit() {
    setForm(buildFormState(countdown));
    setIsEditing(true);
    setError(null);
  }

  function adjustDuration(deltaMinutes: number) {
    setForm((current) => ({
      ...current,
      ...toDurationParts(getDurationMinutes(current) + deltaMinutes),
    }));
  }

  function setDurationPreset(hours: number, minutes: number) {
    setForm((current) => ({
      ...current,
      durationHours: `${hours}`,
      durationMinutes: `${minutes}`.padStart(2, '0'),
    }));
  }

  function adjustExactField(field: ExactField, delta: number) {
    setForm((current) => {
      const next = shiftExactDate(current, field, delta);
      return {
        ...current,
        ...toExactParts(next),
      };
    });
  }

  function setPeriod(period: Meridiem) {
    setForm((current) => {
      const next = getEditableExactDate(current);
      const isCurrentlyPm = next.getHours() >= 12;

      if ((period === 'PM') !== isCurrentlyPm) {
        next.setHours(next.getHours() + (period === 'PM' ? 12 : -12));
      }

      return {
        ...current,
        ...toExactParts(next),
      };
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsBusy(true);

    try {
      if (form.mode === 'duration') {
        const payload = buildDurationPayload(
          Number.parseInt(form.durationHours || '0', 10),
          Number.parseInt(form.durationMinutes || '0', 10),
          '',
          Date.now(),
        );

        if (!payload.durationMs || payload.durationMs <= 0) {
          throw new Error('Pick a duration greater than zero.');
        }

        await window.countdownWidget.start(payload);
      } else {
        const target = buildExactDate(form);

        if (!target) {
          throw new Error('Pick a valid future date and time.');
        }

        if (target.getTime() <= Date.now()) {
          throw new Error('Choose a future date and time.');
        }

        await window.countdownWidget.start({
          mode: 'datetime',
          targetAt: target.toISOString(),
        });
      }

      closeEditor();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to start the countdown.',
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleReset() {
    setError(null);
    await window.countdownWidget.reset();
  }

  return (
    <main className={`widget-shell ${metrics.completed ? 'is-complete' : ''} ${isEditing ? 'is-editing' : ''}`}>
      <div className="ambient-glow ambient-glow-amber" />
      <div className="ambient-glow ambient-glow-cool" />

      <header className="widget-header">
        <div className="brand-block drag-strip">
          <p className="eyebrow">Desktop Countdown</p>
          <h1 className="widget-title">Focus Window</h1>
        </div>

        <div className="header-actions no-drag">
          <button className="action-pill action-pill-primary" onClick={openEdit} type="button">
            {countdown ? 'Retune Timer' : 'Set Timer'}
          </button>
          <button
            className="action-pill action-pill-secondary"
            onClick={() => void window.countdownWidget.minimizeToTray()}
            type="button"
          >
            Minimize
          </button>
        </div>
      </header>

      <section className="widget-grid">
        <section className="hero-well hero-well-main">
          <p className="hero-kicker">Time Left</p>
          <div className="hero-digits">{formattedCountdown}</div>
        </section>

        <aside className="insight-panel">
          <div className="progress-dial" style={{ ['--progress' as string]: progressPercent }}>
            <div className="progress-core">
              <span className="eyebrow">Progress</span>
              <strong>{Math.round(metrics.progress * 100)}%</strong>
            </div>
          </div>

          <div className="stat-stack">
            <div className="stat-card">
              <span>Total</span>
              <strong>{totalLabel}</strong>
            </div>
            <div className="stat-card stat-card-cool">
              <span>Elapsed</span>
              <strong>{elapsedLabel}</strong>
            </div>
            <div className="stat-card stat-card-wide">
              <span>Landing</span>
              <strong>{targetLabel}</strong>
            </div>
          </div>

          <button
            className="action-pill action-pill-secondary action-pill-full"
            disabled={!countdown || !hasLoadedState}
            onClick={() => void handleReset()}
            type="button"
          >
            Reset
          </button>
        </aside>
      </section>

      {hasLoadedState && isEditing ? (
        <div className="editor-layer no-drag">
          <form className="editor-card" onSubmit={handleSubmit}>
            <div className="editor-head">
              <div>
                <p className="eyebrow">Timer Setup</p>
                <h2 className="editor-title">Set the timer</h2>
              </div>

              <button
                className="action-pill action-pill-secondary"
                onClick={closeEditor}
                type="button"
              >
                {countdown ? 'Close' : 'Hide'}
              </button>
            </div>

            <div className="editor-grid">
              <section className="editor-main">
                <div className="mode-toggle">
                  <button
                    className={form.mode === 'duration' ? 'is-selected' : ''}
                    onClick={() => setForm((current) => ({ ...current, mode: 'duration' }))}
                    type="button"
                  >
                    From now
                  </button>
                  <button
                    className={form.mode === 'datetime' ? 'is-selected' : ''}
                    onClick={() => setForm((current) => ({ ...current, mode: 'datetime' }))}
                    type="button"
                  >
                    Exact time
                  </button>
                </div>

                {form.mode === 'duration' ? (
                  <div className="editor-stack">
                    <div className="preset-grid">
                      {PRESET_ACTIONS.map((preset) => (
                        <button
                          key={preset.label}
                          className="preset-chip"
                          onClick={() => setDurationPreset(preset.hours, preset.minutes)}
                          type="button"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>

                    <div className="stepper-grid stepper-grid-two">
                      <ScrubCard
                        label="Hours"
                        nextValue={durationHoursNext}
                        onStep={(delta) => adjustDuration(delta * 60)}
                        previousValue={durationHoursPrevious}
                        value={durationHoursLabel}
                      />
                      <ScrubCard
                        accent="cool"
                        label="Minutes"
                        nextValue={durationMinutesNext}
                        onStep={(delta) => adjustDuration(delta * 5)}
                        previousValue={durationMinutesPrevious}
                        value={durationMinutesLabel}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="editor-stack">
                    <div className="stepper-grid stepper-grid-three">
                      <ScrubCard
                        label="Month"
                        nextValue={nextMonthLabel}
                        onStep={(delta) => adjustExactField('month', delta)}
                        previousValue={previousMonthLabel}
                        value={exactMonthLabel}
                      />
                      <ScrubCard
                        accent="cool"
                        label="Day"
                        nextValue={nextDayLabel}
                        onStep={(delta) => adjustExactField('day', delta)}
                        previousValue={previousDayLabel}
                        value={exactDayLabel}
                      />
                      <ScrubCard
                        label="Year"
                        nextValue={nextYearLabel}
                        onStep={(delta) => adjustExactField('year', delta)}
                        previousValue={previousYearLabel}
                        value={exactYearLabel}
                      />
                    </div>

                    <div className="stepper-grid stepper-grid-three">
                      <ScrubCard
                        label="Hour"
                        nextValue={nextHourLabel}
                        onStep={(delta) => adjustExactField('hour', delta)}
                        previousValue={previousHourLabel}
                        value={exactHourLabel}
                      />
                      <ScrubCard
                        accent="cool"
                        label="Minute"
                        nextValue={nextMinuteLabel}
                        onStep={(delta) => adjustExactField('minute', delta)}
                        previousValue={previousMinuteLabel}
                        value={exactMinuteLabel}
                      />
                      <div className="period-card">
                        <span className="stepper-label">Period</span>
                        <div className="period-toggle">
                          <button
                            className={form.period === 'AM' ? 'is-selected' : ''}
                            onClick={() => setPeriod('AM')}
                            type="button"
                          >
                            AM
                          </button>
                          <button
                            className={form.period === 'PM' ? 'is-selected' : ''}
                            onClick={() => setPeriod('PM')}
                            type="button"
                          >
                            PM
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <aside className="editor-aside">
                <div className={`preview-card ${editorPreview.tone === 'error' ? 'is-error' : ''}`}>
                  <span className="eyebrow">{editorPreview.kicker}</span>
                  <h3>{editorPreview.title}</h3>
                  <p>{editorPreview.detail}</p>
                </div>

                {error ? <p className="error-banner">{error}</p> : null}

                <div className="editor-actions">
                  <button className="action-pill action-pill-primary action-pill-full" disabled={isBusy} type="submit">
                    {isBusy ? 'Starting...' : countdown ? 'Update Timer' : 'Start Timer'}
                  </button>
                  {countdown ? (
                    <button
                      className="action-pill action-pill-secondary action-pill-full"
                      onClick={closeEditor}
                      type="button"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </aside>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
