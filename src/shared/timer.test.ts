import { describe, expect, it } from 'vitest';

import {
  buildDurationPayload,
  formatCountdown,
  getCountdownMetrics,
  getTimerDelayMs,
  hydrateStoredCountdownState,
  isValidStartPayload,
} from './timer';
import type { CountdownState } from './contracts';

describe('timer helpers', () => {
  it('builds a duration payload from hours and minutes', () => {
    const payload = buildDurationPayload(2, 30, 0);

    expect(payload.mode).toBe('duration');
    expect(payload.durationMs).toBe(9_000_000);
    expect(payload.targetAt).toBe('1970-01-01T02:30:00.000Z');
  });

  it('marks expired persisted state as completed during hydration', () => {
    const state: CountdownState = {
      startedAt: '2026-03-21T10:00:00.000Z',
      targetAt: '2026-03-21T11:00:00.000Z',
      durationMs: 3_600_000,
      mode: 'duration',
      completed: false,
    };

    expect(
      hydrateStoredCountdownState(state, Date.parse('2026-03-21T11:30:00.000Z')),
    ).toEqual({
      ...state,
      completed: true,
    });
  });

  it('rejects persisted state with an invalid startedAt value', () => {
    const state: CountdownState = {
      startedAt: 'not-a-date',
      targetAt: '2026-03-21T12:00:00.000Z',
      mode: 'datetime',
      completed: false,
    };

    expect(hydrateStoredCountdownState(state)).toBeNull();
  });

  it('computes remaining time and progress', () => {
    const state: CountdownState = {
      startedAt: '2026-03-21T10:00:00.000Z',
      targetAt: '2026-03-21T12:00:00.000Z',
      durationMs: 7_200_000,
      mode: 'duration',
      completed: false,
    };

    const metrics = getCountdownMetrics(
      state,
      Date.parse('2026-03-21T11:00:00.000Z'),
    );

    expect(metrics.remainingMs).toBe(3_600_000);
    expect(metrics.elapsedMs).toBe(3_600_000);
    expect(metrics.progress).toBe(0.5);
    expect(metrics.completed).toBe(false);
  });

  it('avoids NaN metrics when startedAt is corrupted but durationMs is valid', () => {
    const state: CountdownState = {
      startedAt: 'not-a-date',
      targetAt: '2026-03-21T12:00:00.000Z',
      durationMs: 7_200_000,
      mode: 'duration',
      completed: false,
    };

    const metrics = getCountdownMetrics(
      state,
      Date.parse('2026-03-21T11:00:00.000Z'),
    );

    expect(metrics.totalMs).toBe(7_200_000);
    expect(metrics.elapsedMs).toBe(3_600_000);
    expect(metrics.progress).toBe(0.5);
  });

  it('caps timer delay to the max safe timeout', () => {
    const state: CountdownState = {
      startedAt: '2026-03-21T10:00:00.000Z',
      targetAt: '2026-05-21T10:00:00.000Z',
      mode: 'datetime',
      completed: false,
    };

    expect(getTimerDelayMs(state, Date.parse('2026-03-21T10:00:00.000Z'))).toBe(
      2_147_483_647,
    );
  });

  it('returns null timer delay for an invalid target', () => {
    const state: CountdownState = {
      startedAt: '2026-03-21T10:00:00.000Z',
      targetAt: 'not-a-date',
      mode: 'datetime',
      completed: false,
    };

    expect(getTimerDelayMs(state)).toBeNull();
  });

  it('formats countdown display for hours and minutes', () => {
    expect(formatCountdown(7_265_000)).toBe('02:01:05');
    expect(formatCountdown(305_000)).toBe('05:05');
  });

  it('rejects start payloads with an unknown mode', () => {
    expect(
      isValidStartPayload({
        mode: 'invalid' as never,
        targetAt: '2026-03-21T12:00:00.000Z',
      }),
    ).toBe(false);
  });

});
