import type {
  CountdownState,
  TodoOverflowMode,
  TodoTask,
  TodoTaskDraft,
  TodoTaskStatus,
} from './contracts';
import { clampNumber } from './timer';

export const MAX_TODO_ITEMS = 3;
export const MAX_TODO_TITLE_LENGTH = 60;

type TodoConfig = {
  durationMs: number;
  plannedStartAt: string;
  plannedStartMs: number;
  overflowMode: TodoOverflowMode;
};

export type TodoTaskTiming = {
  status: TodoTaskStatus;
  effectiveStartAt: string | null;
  effectiveEndAt: string | null;
  effectiveDurationMs: number;
  remainingMs: number;
  progress: number;
  invalidReason: string | null;
  sessionMissing: boolean;
};

type ReconcileTodosResult = {
  todos: TodoTask[];
  changed: boolean;
};

const VALID_TODO_OVERFLOW_MODES: TodoOverflowMode[] = ['cap', 'bleed'];

function sanitizeIsoDateTime(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return new Date(parsed).toISOString();
}

function sanitizeDurationMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.max(60_000, Math.floor(value));
}

export function isTodoOverflowMode(value: unknown): value is TodoOverflowMode {
  return typeof value === 'string' && VALID_TODO_OVERFLOW_MODES.includes(value as TodoOverflowMode);
}

export function sanitizeTodoTitle(title: unknown): string | null {
  if (typeof title !== 'string') {
    return null;
  }

  const normalized = title.replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, MAX_TODO_TITLE_LENGTH);
}

function getTodoConfig(task: TodoTask): TodoConfig | null {
  const durationMs = sanitizeDurationMs(task.durationMs);
  const plannedStartAt = sanitizeIsoDateTime(task.plannedStartAt);
  const overflowMode = isTodoOverflowMode(task.overflowMode) ? task.overflowMode : undefined;

  if (!durationMs || !plannedStartAt || !overflowMode) {
    return null;
  }

  return {
    durationMs,
    plannedStartAt,
    plannedStartMs: Date.parse(plannedStartAt),
    overflowMode,
  };
}

function getCountdownWindow(countdown: CountdownState | null) {
  if (!countdown) {
    return null;
  }

  const startedMs = Date.parse(countdown.startedAt);
  const targetMs = Date.parse(countdown.targetAt);

  if (Number.isNaN(startedMs) || Number.isNaN(targetMs)) {
    return null;
  }

  return {
    startedMs,
    targetMs,
  };
}

function buildTimingResult(
  status: TodoTaskStatus,
  config: TodoConfig | null,
  options?: Partial<TodoTaskTiming>,
): TodoTaskTiming {
  return {
    status,
    effectiveStartAt: options?.effectiveStartAt ?? null,
    effectiveEndAt: options?.effectiveEndAt ?? null,
    effectiveDurationMs: options?.effectiveDurationMs ?? config?.durationMs ?? 0,
    remainingMs: options?.remainingMs ?? 0,
    progress: clampNumber(options?.progress ?? 0, 0, 1),
    invalidReason: options?.invalidReason ?? null,
    sessionMissing: options?.sessionMissing ?? false,
  };
}

function getConfiguredWindow(
  config: TodoConfig,
  startMs: number,
  countdownWindow: { startedMs: number; targetMs: number } | null,
) {
  const uncappedEndMs = startMs + config.durationMs;

  if (!countdownWindow || config.overflowMode === 'bleed') {
    return {
      endMs: uncappedEndMs,
      durationMs: config.durationMs,
    };
  }

  const endMs = Math.min(uncappedEndMs, countdownWindow.targetMs);

  return {
    endMs,
    durationMs: Math.max(0, endMs - startMs),
  };
}

function areTodoTasksEqual(left: TodoTask[], right: TodoTask[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((task, index) => {
    const other = right[index];

    return task.id === other.id
      && task.title === other.title
      && task.completed === other.completed
      && task.completedAt === other.completedAt
      && task.durationMs === other.durationMs
      && task.startMode === other.startMode
      && task.plannedStartAt === other.plannedStartAt
      && task.actualStartedAt === other.actualStartedAt
      && task.overflowMode === other.overflowMode;
  });
}

export function sanitizeTodoDraft(draft: unknown): TodoTaskDraft | null {
  if (typeof draft !== 'object' || draft === null) {
    return null;
  }

  const candidate = draft as Partial<TodoTaskDraft>;
  const title = sanitizeTodoTitle(candidate.title);
  const durationMs = sanitizeDurationMs(candidate.durationMs);
  const plannedStartAt = sanitizeIsoDateTime(candidate.plannedStartAt);
  const overflowMode = isTodoOverflowMode(candidate.overflowMode) ? candidate.overflowMode : undefined;

  if (!title) {
    return null;
  }

  const hasAnyTimingField = candidate.durationMs !== undefined
    || candidate.plannedStartAt !== undefined
    || candidate.overflowMode !== undefined;

  if (!hasAnyTimingField) {
    return { title };
  }

  if (!durationMs || !plannedStartAt || !overflowMode) {
    return null;
  }

  return {
    title,
    durationMs,
    plannedStartAt,
    overflowMode,
  };
}

export function hasTodoTimingConfig(task: TodoTask): boolean {
  return getTodoConfig(task) !== null;
}

export function createTodoTask(draft: unknown, id: string): TodoTask | null {
  const sanitizedDraft = sanitizeTodoDraft(draft);
  const sanitizedId = id.trim();

  if (!sanitizedDraft || !sanitizedId) {
    return null;
  }

  return {
    id: sanitizedId,
    title: sanitizedDraft.title,
    completed: false,
    durationMs: sanitizedDraft.durationMs,
    startMode: sanitizedDraft.durationMs && sanitizedDraft.plannedStartAt && sanitizedDraft.overflowMode
      ? 'scheduled'
      : undefined,
    plannedStartAt: sanitizedDraft.plannedStartAt,
    overflowMode: sanitizedDraft.overflowMode,
  };
}

export function hydrateStoredTodos(value: unknown): TodoTask[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const hydrated: TodoTask[] = [];

  for (const item of value) {
    if (hydrated.length >= MAX_TODO_ITEMS) {
      break;
    }

    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const candidate = item as Partial<TodoTask>;
    const title = sanitizeTodoTitle(candidate.title);
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';

    if (!title || !id) {
      continue;
    }

    const completed = candidate.completed === true;
    const completedAt = completed ? sanitizeIsoDateTime(candidate.completedAt) : undefined;
    const durationMs = sanitizeDurationMs(candidate.durationMs);
    const plannedStartAt = sanitizeIsoDateTime(candidate.plannedStartAt);
    const actualStartedAt = sanitizeIsoDateTime(candidate.actualStartedAt);
    const overflowMode = isTodoOverflowMode(candidate.overflowMode) ? candidate.overflowMode : undefined;
    const startMode = durationMs && plannedStartAt && overflowMode ? 'scheduled' : undefined;

    hydrated.push({
      id,
      title,
      completed,
      completedAt,
      durationMs,
      plannedStartAt,
      actualStartedAt,
      startMode,
      overflowMode,
    });
  }

  return hydrated;
}

export function reorderTodoTasks(tasks: TodoTask[], orderedIds: string[]): TodoTask[] {
  if (orderedIds.length !== tasks.length) {
    return tasks;
  }

  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const reordered: TodoTask[] = [];

  for (const id of orderedIds) {
    const task = taskMap.get(id);

    if (!task) {
      return tasks;
    }

    reordered.push(task);
    taskMap.delete(id);
  }

  if (taskMap.size > 0) {
    return tasks;
  }

  return reordered;
}

export function resetTodoRuntimeState(tasks: TodoTask[]): TodoTask[] {
  return tasks.map((task) => (
    task.completed || !task.actualStartedAt
      ? task
      : { ...task, actualStartedAt: undefined }
  ));
}

export function reconcileTodoTasks(
  tasks: TodoTask[],
  countdown: CountdownState | null,
  nowMs = Date.now(),
): ReconcileTodosResult {
  const countdownWindow = getCountdownWindow(countdown);
  const reconciled = tasks.map((task) => {
    if (task.completed || !hasTodoTimingConfig(task)) {
      return task;
    }

    const config = getTodoConfig(task);

    if (!config) {
      return task;
    }

    if (!countdownWindow) {
      return task.actualStartedAt ? { ...task, actualStartedAt: undefined } : task;
    }

    const actualStartedAt = sanitizeIsoDateTime(task.actualStartedAt);

    if (actualStartedAt) {
      const actualStartedMs = Date.parse(actualStartedAt);

      if (
        actualStartedMs < countdownWindow.startedMs
        || actualStartedMs >= countdownWindow.targetMs
      ) {
        return {
          ...task,
          actualStartedAt: undefined,
        };
      }
    }

    if (
      !actualStartedAt
      && config.plannedStartMs >= countdownWindow.startedMs
      && config.plannedStartMs < countdownWindow.targetMs
      && config.plannedStartMs <= nowMs
    ) {
      return {
        ...task,
        actualStartedAt: config.plannedStartAt,
      };
    }

    return task;
  });

  return {
    todos: reconciled,
    changed: !areTodoTasksEqual(tasks, reconciled),
  };
}

export function getTodoTaskTiming(
  task: TodoTask,
  countdown: CountdownState | null,
  nowMs = Date.now(),
): TodoTaskTiming {
  const config = getTodoConfig(task);

  if (!config) {
    return buildTimingResult('needs_setup', null);
  }

  const countdownWindow = getCountdownWindow(countdown);
  const actualStartedAt = sanitizeIsoDateTime(task.actualStartedAt);
  const completedAt = sanitizeIsoDateTime(task.completedAt);
  const actualStartedMs = actualStartedAt ? Date.parse(actualStartedAt) : null;
  const completedAtMs = completedAt ? Date.parse(completedAt) : null;

  if (task.completed) {
    const startMs = actualStartedMs ?? config.plannedStartMs;
    const endMs = completedAtMs ?? startMs;

    return buildTimingResult('completed', config, {
      effectiveStartAt: new Date(startMs).toISOString(),
      effectiveEndAt: new Date(endMs).toISOString(),
      effectiveDurationMs: Math.max(0, endMs - startMs) || config.durationMs,
      remainingMs: 0,
      progress: 1,
      sessionMissing: !countdownWindow,
    });
  }

  if (!countdownWindow) {
    return buildTimingResult('scheduled', config, {
      effectiveStartAt: config.plannedStartAt,
      sessionMissing: true,
      remainingMs: config.durationMs,
    });
  }

  if (config.plannedStartMs < countdownWindow.startedMs) {
    return buildTimingResult('invalid', config, {
      invalidReason: 'Start time is before the current session begins.',
    });
  }

  if (config.plannedStartMs >= countdownWindow.targetMs) {
    return buildTimingResult('invalid', config, {
      invalidReason: 'Start time must be before the global timer ends.',
    });
  }

  const effectiveManualStartMs = actualStartedMs && actualStartedMs >= countdownWindow.startedMs
    && actualStartedMs < countdownWindow.targetMs
    ? actualStartedMs
    : null;

  const effectiveStartMs = effectiveManualStartMs ?? config.plannedStartMs;
  const window = getConfiguredWindow(config, effectiveStartMs, countdownWindow);

  if (window.durationMs <= 0) {
    return buildTimingResult('invalid', config, {
      effectiveStartAt: new Date(effectiveStartMs).toISOString(),
      invalidReason: 'No time is available before the global timer ends.',
    });
  }

  const effectiveStartAt = new Date(effectiveStartMs).toISOString();
  const effectiveEndAt = new Date(window.endMs).toISOString();
  const remainingMs = Math.max(0, window.endMs - nowMs);
  const elapsedMs = clampNumber(nowMs - effectiveStartMs, 0, window.durationMs);
  const progress = window.durationMs > 0 ? elapsedMs / window.durationMs : 0;

  if (nowMs >= window.endMs) {
    return buildTimingResult('overdue', config, {
      effectiveStartAt,
      effectiveEndAt,
      effectiveDurationMs: window.durationMs,
      remainingMs: 0,
      progress: 1,
    });
  }

  if (nowMs < effectiveStartMs) {
    return buildTimingResult('scheduled', config, {
      effectiveStartAt,
      effectiveEndAt,
      effectiveDurationMs: window.durationMs,
      remainingMs: window.durationMs,
    });
  }

  return buildTimingResult('active', config, {
    effectiveStartAt,
    effectiveEndAt,
    effectiveDurationMs: window.durationMs,
    remainingMs,
    progress,
  });
}
