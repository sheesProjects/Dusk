import { describe, expect, it } from 'vitest';

import type { CountdownState, TodoTask } from './contracts';
import {
  MAX_TODO_ITEMS,
  createTodoTask,
  getTodoTaskTiming,
  hasTodoTimingConfig,
  hydrateStoredTodos,
  reconcileTodoTasks,
  reorderTodoTasks,
  resetTodoRuntimeState,
  sanitizeTodoDraft,
  sanitizeTodoTitle,
} from './todo';

const ACTIVE_COUNTDOWN: CountdownState = {
  mode: 'duration',
  startedAt: '2026-03-22T10:00:00.000Z',
  targetAt: '2026-03-22T12:00:00.000Z',
  durationMs: 7_200_000,
  completed: false,
};

function createConfiguredTask(overrides: Partial<TodoTask> = {}): TodoTask {
  return {
    id: 'task-1',
    title: 'Write notes',
    completed: false,
    durationMs: 1_800_000,
    startMode: 'scheduled',
    plannedStartAt: '2026-03-22T10:30:00.000Z',
    overflowMode: 'cap',
    ...overrides,
  };
}

describe('todo helpers', () => {
  it('sanitizes and trims task titles', () => {
    expect(sanitizeTodoTitle('   Ship   build   tonight   ')).toBe('Ship build tonight');
  });

  it('sanitizes structured todo drafts', () => {
    expect(sanitizeTodoDraft({
      title: '  Deep work block  ',
      durationMs: 1_800_000,
      startMode: 'manual',
      plannedStartAt: '2026-03-22T10:45:00.000Z',
      overflowMode: 'bleed',
    })).toEqual({
      title: 'Deep work block',
      durationMs: 1_800_000,
      plannedStartAt: '2026-03-22T10:45:00.000Z',
      overflowMode: 'bleed',
    });
  });

  it('sanitizes title-only todo drafts for unscheduled tasks', () => {
    expect(sanitizeTodoDraft({
      title: '  Inbox cleanup  ',
    })).toEqual({
      title: 'Inbox cleanup',
    });
  });

  it('rejects invalid todo drafts', () => {
    expect(sanitizeTodoDraft({
      title: 'Test',
      durationMs: 0,
      startMode: 'manual',
      plannedStartAt: 'wat',
      overflowMode: 'cap',
    })).toBeNull();
  });

  it('creates a configured todo task with the stable v2 shape', () => {
    expect(createTodoTask({
      title: 'Write notes',
      durationMs: 1_800_000,
      startMode: 'scheduled',
      plannedStartAt: '2026-03-22T10:30:00.000Z',
      overflowMode: 'cap',
    }, 'task-1')).toEqual({
      id: 'task-1',
      title: 'Write notes',
      completed: false,
      durationMs: 1_800_000,
      startMode: 'scheduled',
      plannedStartAt: '2026-03-22T10:30:00.000Z',
      overflowMode: 'cap',
    });
  });

  it('creates an unscheduled todo task when only a title is provided', () => {
    expect(createTodoTask({
      title: 'Loose task',
    }, 'task-2')).toEqual({
      id: 'task-2',
      title: 'Loose task',
      completed: false,
    });
  });

  it('hydrates stored todos, preserving legacy tasks as needs-setup compatible entries', () => {
    expect(
      hydrateStoredTodos([
        { id: '1', title: 'Legacy task', completed: true },
        { id: '2', title: 'Configured', completed: false, durationMs: 900_000, startMode: 'manual', plannedStartAt: '2026-03-22T10:20:00.000Z', overflowMode: 'bleed' },
      ]),
    ).toEqual([
      { id: '1', title: 'Legacy task', completed: true },
      {
        id: '2',
        title: 'Configured',
        completed: false,
        durationMs: 900_000,
        startMode: 'scheduled',
        plannedStartAt: '2026-03-22T10:20:00.000Z',
        overflowMode: 'bleed',
      },
    ]);
  });

  it('drops invalid stored items and caps the list at three tasks', () => {
    expect(
      hydrateStoredTodos([
        { id: '1', title: 'One', completed: false },
        { id: '2', title: 'Two', completed: true },
        { nope: true },
        { id: '3', title: 'Three', completed: false },
        { id: '4', title: 'Four', completed: false },
      ]),
    ).toEqual([
      { id: '1', title: 'One', completed: false },
      { id: '2', title: 'Two', completed: true },
      { id: '3', title: 'Three', completed: false },
    ]);
  });

  it('keeps the hard task limit at three', () => {
    expect(MAX_TODO_ITEMS).toBe(3);
  });

  it('reorders tasks by the provided order', () => {
    expect(
      reorderTodoTasks([
        createConfiguredTask({ id: '1', title: 'One' }),
        createConfiguredTask({ id: '2', title: 'Two' }),
        createConfiguredTask({ id: '3', title: 'Three' }),
      ], ['2', '1', '3']),
    ).toEqual([
      createConfiguredTask({ id: '2', title: 'Two' }),
      createConfiguredTask({ id: '1', title: 'One' }),
      createConfiguredTask({ id: '3', title: 'Three' }),
    ]);
  });

  it('flags missing timing data as needs setup', () => {
    const timing = getTodoTaskTiming(
      { id: 'legacy', title: 'Legacy task', completed: false },
      ACTIVE_COUNTDOWN,
      Date.parse('2026-03-22T10:15:00.000Z'),
    );

    expect(hasTodoTimingConfig({ id: 'legacy', title: 'Legacy task', completed: false })).toBe(false);
    expect(timing.status).toBe('needs_setup');
  });

  it('computes scheduled cap timing', () => {
    const timing = getTodoTaskTiming(
      createConfiguredTask(),
      ACTIVE_COUNTDOWN,
      Date.parse('2026-03-22T10:45:00.000Z'),
    );

    expect(timing.status).toBe('active');
    expect(timing.effectiveStartAt).toBe('2026-03-22T10:30:00.000Z');
    expect(timing.effectiveEndAt).toBe('2026-03-22T11:00:00.000Z');
    expect(timing.remainingMs).toBe(900_000);
    expect(timing.progress).toBeCloseTo(0.5);
  });

  it('caps tasks at the global timer end when configured to cap', () => {
    const timing = getTodoTaskTiming(
      createConfiguredTask({
        plannedStartAt: '2026-03-22T11:30:00.000Z',
        durationMs: 3_600_000,
        overflowMode: 'cap',
      }),
      ACTIVE_COUNTDOWN,
      Date.parse('2026-03-22T11:40:00.000Z'),
    );

    expect(timing.status).toBe('active');
    expect(timing.effectiveEndAt).toBe('2026-03-22T12:00:00.000Z');
    expect(timing.effectiveDurationMs).toBe(1_800_000);
    expect(timing.progress).toBeCloseTo(1 / 3);
  });

  it('lets bleed tasks extend past the global timer end', () => {
    const timing = getTodoTaskTiming(
      createConfiguredTask({
        plannedStartAt: '2026-03-22T11:30:00.000Z',
        durationMs: 3_600_000,
        overflowMode: 'bleed',
      }),
      ACTIVE_COUNTDOWN,
      Date.parse('2026-03-22T12:10:00.000Z'),
    );

    expect(timing.status).toBe('active');
    expect(timing.effectiveEndAt).toBe('2026-03-22T12:30:00.000Z');
    expect(timing.remainingMs).toBe(1_200_000);
  });

  it('keeps configured tasks scheduled before their planned start', () => {
    const timing = getTodoTaskTiming(
      createConfiguredTask(),
      ACTIVE_COUNTDOWN,
      Date.parse('2026-03-22T10:20:00.000Z'),
    );

    expect(timing.status).toBe('scheduled');
    expect(timing.progress).toBe(0);
  });

  it('automatically starts tasks once their planned start passes', () => {
    const timing = getTodoTaskTiming(
      createConfiguredTask(),
      ACTIVE_COUNTDOWN,
      Date.parse('2026-03-22T10:35:00.000Z'),
    );

    expect(timing.status).toBe('active');
    expect(timing.effectiveStartAt).toBe('2026-03-22T10:30:00.000Z');
    expect(timing.remainingMs).toBe(1_500_000);
  });

  it('uses an early manual start time when a task is started before plan', () => {
    const timing = getTodoTaskTiming(
      createConfiguredTask({
        actualStartedAt: '2026-03-22T10:20:00.000Z',
      }),
      ACTIVE_COUNTDOWN,
      Date.parse('2026-03-22T10:40:00.000Z'),
    );

    expect(timing.status).toBe('active');
    expect(timing.effectiveStartAt).toBe('2026-03-22T10:20:00.000Z');
    expect(timing.effectiveEndAt).toBe('2026-03-22T10:50:00.000Z');
  });

  it('freezes completed tasks at 100 percent', () => {
    const timing = getTodoTaskTiming(
      createConfiguredTask({
        completed: true,
        completedAt: '2026-03-22T10:47:00.000Z',
        actualStartedAt: '2026-03-22T10:40:00.000Z',
      }),
      ACTIVE_COUNTDOWN,
      Date.parse('2026-03-22T10:50:00.000Z'),
    );

    expect(timing.status).toBe('completed');
    expect(timing.progress).toBe(1);
    expect(timing.remainingMs).toBe(0);
  });

  it('marks tasks overdue once their effective end passes', () => {
    const timing = getTodoTaskTiming(
      createConfiguredTask(),
      ACTIVE_COUNTDOWN,
      Date.parse('2026-03-22T11:05:00.000Z'),
    );

    expect(timing.status).toBe('overdue');
    expect(timing.progress).toBe(1);
  });

  it('marks late-session tasks overdue after their capped end passes', () => {
    const timing = getTodoTaskTiming(
      createConfiguredTask({
        plannedStartAt: '2026-03-22T11:45:00.000Z',
      }),
      ACTIVE_COUNTDOWN,
      Date.parse('2026-03-22T12:05:00.000Z'),
    );

    expect(timing.status).toBe('overdue');
    expect(timing.effectiveEndAt).toBe('2026-03-22T12:00:00.000Z');
  });

  it('marks tasks invalid when their start time falls outside the current session', () => {
    const timing = getTodoTaskTiming(
      createConfiguredTask({
        plannedStartAt: '2026-03-22T12:15:00.000Z',
      }),
      ACTIVE_COUNTDOWN,
      Date.parse('2026-03-22T10:15:00.000Z'),
    );

    expect(timing.status).toBe('invalid');
    expect(timing.invalidReason).toContain('before the global timer ends');
  });

  it('clears incomplete runtime start state when there is no active session', () => {
    expect(resetTodoRuntimeState([
      createConfiguredTask({ actualStartedAt: '2026-03-22T10:35:00.000Z' }),
      createConfiguredTask({ id: '2', completed: true, actualStartedAt: '2026-03-22T10:35:00.000Z' }),
    ])).toEqual([
      createConfiguredTask({ actualStartedAt: undefined }),
      createConfiguredTask({ id: '2', completed: true, actualStartedAt: '2026-03-22T10:35:00.000Z' }),
    ]);
  });

  it('reconciles scheduled tasks by stamping their actual start once due', () => {
    const result = reconcileTodoTasks(
      [createConfiguredTask()],
      ACTIVE_COUNTDOWN,
      Date.parse('2026-03-22T10:35:00.000Z'),
    );

    expect(result.changed).toBe(true);
    expect(result.todos[0]?.actualStartedAt).toBe('2026-03-22T10:30:00.000Z');
  });

  it('treats configured tasks as dormant when there is no active session', () => {
    const timing = getTodoTaskTiming(
      createConfiguredTask(),
      null,
      Date.parse('2026-03-22T10:35:00.000Z'),
    );

    expect(timing.sessionMissing).toBe(true);
    expect(timing.status).toBe('scheduled');
  });
});
