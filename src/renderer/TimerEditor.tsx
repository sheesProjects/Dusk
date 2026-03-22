import { useEffect, useMemo, useState } from 'react';

import type { CountdownState, TimerMode } from '../shared/contracts';
import {
  type ExactField,
  MONTH_NAMES,
  type Meridiem,
  buildExactDate,
  getDurationMinutes,
  shiftExactDate as shiftEditorExactDate,
  toDurationParts,
  toExactParts,
} from '../shared/editorTime';
import {
  buildDurationPayload,
  describeDuration,
  formatEditorialTarget,
} from '../shared/timer';
import { ScrubCard } from './ScrubCard';

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

type TimerEditorProps = {
  countdown: CountdownState | null;
  now: number;
  open: boolean;
  onClose: () => void;
};

const PRESET_ACTIONS = [
  { label: '30m', hours: 0, minutes: 30 },
  { label: '1h', hours: 1, minutes: 0 },
  { label: '2h', hours: 2, minutes: 0 },
  { label: '4h', hours: 4, minutes: 0 },
] as const;

function getFallbackTarget(nowMs = Date.now()) {
  const fallback = new Date(nowMs + (2 * 60 * 60 * 1000));
  fallback.setSeconds(0, 0);
  return fallback;
}

function buildFormState(countdown: CountdownState | null) {
  const fallbackExact = toExactParts(getFallbackTarget());

  if (!countdown) {
    return {
      mode: 'duration' as const,
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

function shiftExactDate(form: FormState, field: ExactField, delta: number) {
  return shiftEditorExactDate(getEditableExactDate(form), field, delta);
}

function getEditableExactDate(form: FormState) {
  return buildExactDate(form) ?? getFallbackTarget();
}

export function TimerEditor({
  countdown,
  now,
  open,
  onClose,
}: TimerEditorProps) {
  const [form, setForm] = useState<FormState>(() => buildFormState(countdown));
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setForm(buildFormState(countdown));
    setError(null);
  }, [countdown, open]);

  const editorPreview = useMemo<PreviewState | null>(() => {
    if (!open) {
      return null;
    }

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
  }, [form, now, open]);

  if (!open) {
    return null;
  }

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsBusy(true);

    try {
      if (form.mode === 'duration') {
        const payload = buildDurationPayload(
          Number.parseInt(form.durationHours || '0', 10),
          Number.parseInt(form.durationMinutes || '0', 10),
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

      onClose();
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

  return (
    <div className="editor-layer no-drag">
      <form className="editor-card" onSubmit={handleSubmit}>
        <div className="editor-head">
          <div>
            <p className="eyebrow">Timer Setup</p>
            <h2 className="editor-title">Set the timer</h2>
          </div>

          <button
            className="action-pill action-pill-secondary"
            onClick={onClose}
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
                      onClick={() => setForm((current) => ({
                        ...current,
                        durationHours: `${preset.hours}`,
                        durationMinutes: `${preset.minutes}`.padStart(2, '0'),
                      }))}
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
                    onStep={(delta) => setForm((current) => ({
                      ...current,
                      ...toDurationParts(getDurationMinutes(current) + (delta * 60)),
                    }))}
                    previousValue={durationHoursPrevious}
                    value={durationHoursLabel}
                  />
                  <ScrubCard
                    accent="cool"
                    label="Minutes"
                    nextValue={durationMinutesNext}
                    onStep={(delta) => setForm((current) => ({
                      ...current,
                      ...toDurationParts(getDurationMinutes(current) + (delta * 5)),
                    }))}
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
                    onStep={(delta) => setForm((current) => ({ ...current, ...toExactParts(shiftExactDate(current, 'month', delta)) }))}
                    previousValue={previousMonthLabel}
                    value={exactMonthLabel}
                  />
                  <ScrubCard
                    accent="cool"
                    label="Day"
                    nextValue={nextDayLabel}
                    onStep={(delta) => setForm((current) => ({ ...current, ...toExactParts(shiftExactDate(current, 'day', delta)) }))}
                    previousValue={previousDayLabel}
                    value={exactDayLabel}
                  />
                  <ScrubCard
                    label="Year"
                    nextValue={nextYearLabel}
                    onStep={(delta) => setForm((current) => ({ ...current, ...toExactParts(shiftExactDate(current, 'year', delta)) }))}
                    previousValue={previousYearLabel}
                    value={exactYearLabel}
                  />
                </div>

                <div className="stepper-grid stepper-grid-three">
                  <ScrubCard
                    label="Hour"
                    nextValue={nextHourLabel}
                    onStep={(delta) => setForm((current) => ({ ...current, ...toExactParts(shiftExactDate(current, 'hour', delta)) }))}
                    previousValue={previousHourLabel}
                    value={exactHourLabel}
                  />
                  <ScrubCard
                    accent="cool"
                    label="Minute"
                    nextValue={nextMinuteLabel}
                    onStep={(delta) => setForm((current) => ({ ...current, ...toExactParts(shiftExactDate(current, 'minute', delta)) }))}
                    previousValue={previousMinuteLabel}
                    value={exactMinuteLabel}
                  />
                  <div className="period-card">
                    <span className="stepper-label">Period</span>
                    <div className="period-toggle">
                      <button
                        className={form.period === 'AM' ? 'is-selected' : ''}
                        onClick={() => setForm((current) => {
                          const next = getEditableExactDate(current);
                          if (next.getHours() >= 12) {
                            next.setHours(next.getHours() - 12);
                          }

                          return {
                            ...current,
                            ...toExactParts(next),
                          };
                        })}
                        type="button"
                      >
                        AM
                      </button>
                      <button
                        className={form.period === 'PM' ? 'is-selected' : ''}
                        onClick={() => setForm((current) => {
                          const next = getEditableExactDate(current);
                          if (next.getHours() < 12) {
                            next.setHours(next.getHours() + 12);
                          }

                          return {
                            ...current,
                            ...toExactParts(next),
                          };
                        })}
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
                {editorPreview ? (
                  <div className={`preview-card ${editorPreview.tone === 'error' ? 'is-error' : ''}`}>
                    <span className="eyebrow">{editorPreview.kicker}</span>
                    <h3>{editorPreview.title}</h3>
                    <p>{editorPreview.detail}</p>
                  </div>
                ) : null}

            {error ? <p className="error-banner">{error}</p> : null}

            <div className="editor-actions">
              <button className="action-pill action-pill-primary action-pill-full" disabled={isBusy} type="submit">
                {isBusy ? 'Starting...' : countdown ? 'Update Timer' : 'Start Timer'}
              </button>
              {countdown ? (
                <button
                  className="action-pill action-pill-secondary action-pill-full"
                  onClick={onClose}
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
  );
}
