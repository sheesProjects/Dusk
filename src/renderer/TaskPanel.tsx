import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  CountdownState,
  TodoOverflowMode,
  TodoTask,
  TodoTaskDraft,
} from '../shared/contracts';
import {
  MAX_TODO_ITEMS,
  type TodoTaskTiming,
  getTodoTaskTiming,
  hasTodoTimingConfig,
} from '../shared/todo';
import {
  type ExactField,
  MONTH_NAMES,
  type Meridiem,
  MIN_EDITOR_YEAR,
  buildExactDate,
  getDurationMinutes,
  shiftExactDate as shiftEditorExactDate,
  toDurationParts,
  toExactParts,
} from '../shared/editorTime';
import {
  describeDuration,
  durationToMs,
  formatCountdown,
} from '../shared/timer';
import { ScrubCard } from './ScrubCard';

type TodoDropPosition = 'before' | 'after';

type TaskFormState = {
  title: string;
  durationHours: string;
  durationMinutes: string;
  month: string;
  day: string;
  year: string;
  hour: string;
  minute: string;
  period: Meridiem;
  overflowMode: TodoOverflowMode;
};

type TaskEditorState = {
  mode: 'create' | 'edit';
  taskId: string | null;
  form: TaskFormState;
  timingEnabled: boolean;
};

type TaskPresentation = {
  task: TodoTask;
  timing: TodoTaskTiming;
  statusTone: 'warm' | 'danger' | 'muted';
  primaryMeta: string;
  canStartNow: boolean;
  showInlineProgress: boolean;
};

type PreviewState = {
  tone: 'normal' | 'error';
  kicker: string;
  title: string;
  detail: string;
};

type TaskPanelProps = {
  closeSignal: number;
  countdown: CountdownState | null;
  now: number;
  todos: TodoTask[];
  onTodosChange: (todos: TodoTask[]) => void;
  onOverlayChange: (open: boolean) => void;
  onRequestHideTimerEditor: () => void;
};

const TASK_DURATION_PRESETS = [
  { label: '15m', hours: 0, minutes: 15 },
  { label: '30m', hours: 0, minutes: 30 },
  { label: '45m', hours: 0, minutes: 45 },
  { label: '1h', hours: 1, minutes: 0 },
] as const;

function formatPlannedStart(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatTimeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function getRoundedTaskStart(nowMs = Date.now()) {
  const date = new Date(nowMs + (15 * 60_000));
  date.setSeconds(0, 0);
  const remainder = date.getMinutes() % 5;

  if (remainder !== 0) {
    date.setMinutes(date.getMinutes() + (5 - remainder));
  }

  return date;
}

function getDefaultTaskStart(countdown: CountdownState | null, nowMs = Date.now()) {
  const rounded = getRoundedTaskStart(nowMs);

  if (!countdown) {
    return rounded;
  }

  const sessionStart = new Date(countdown.startedAt);
  return rounded.getTime() > sessionStart.getTime() ? rounded : sessionStart;
}

function getEditableTaskStart(
  form: TaskFormState,
  countdown: CountdownState | null,
  nowMs = Date.now(),
) {
  return buildExactDate(form) ?? getDefaultTaskStart(countdown, nowMs);
}

function shiftTaskStart(
  form: TaskFormState,
  countdown: CountdownState | null,
  field: ExactField,
  delta: number,
  nowMs = Date.now(),
) {
  return shiftEditorExactDate(getEditableTaskStart(form, countdown, nowMs), field, delta);
}

function buildTaskFormState(task: TodoTask | null, countdown: CountdownState | null, nowMs = Date.now()) {
  const totalMinutes = Math.max(30, Math.round((task?.durationMs ?? 1_800_000) / 60_000));
  const duration = toDurationParts(totalMinutes);
  const plannedStart = task?.plannedStartAt
    ? new Date(task.plannedStartAt)
    : getDefaultTaskStart(countdown, nowMs);

  return {
    title: task?.title ?? '',
    durationHours: duration.durationHours,
    durationMinutes: duration.durationMinutes,
    ...toExactParts(plannedStart),
    overflowMode: task?.overflowMode ?? 'cap',
  };
}

function buildTaskDraft(form: TaskFormState, timingEnabled: boolean): TodoTaskDraft | null {
  if (!form.title.trim()) {
    return null;
  }

  if (!timingEnabled) {
    return {
      title: form.title,
    };
  }

  const plannedStart = buildExactDate(form);
  const durationMs = durationToMs(
    Number.parseInt(form.durationHours || '0', 10),
    Number.parseInt(form.durationMinutes || '0', 10),
  );

  if (!plannedStart || durationMs <= 0) {
    return null;
  }

  return {
    title: form.title,
    durationMs,
    plannedStartAt: plannedStart.toISOString(),
    overflowMode: form.overflowMode,
  };
}

function getTaskPreview(
  form: TaskFormState,
  countdown: CountdownState | null,
  timingEnabled: boolean,
  nowMs: number,
): PreviewState {
  const draft = buildTaskDraft(form, timingEnabled);

  if (!draft) {
    return {
      tone: 'error',
      kicker: 'Task',
      title: 'Incomplete task',
      detail: 'Add a task name.',
    };
  }

  if (!timingEnabled) {
    return {
      tone: 'normal',
      kicker: 'Task',
      title: 'No schedule',
      detail: 'This task will stay in the list without its own timer until you add timing.',
    };
  }

  const draftDurationMs = draft.durationMs;
  const draftPlannedStartAt = draft.plannedStartAt;
  const draftOverflowMode = draft.overflowMode;

  if (!draftDurationMs || !draftPlannedStartAt || !draftOverflowMode) {
    return {
      tone: 'error',
      kicker: 'Task Window',
      title: 'Incomplete task',
      detail: 'Add a start time and duration to schedule this task.',
    };
  }

  const plannedStartMs = Date.parse(draftPlannedStartAt);
  const relativeStartMs = plannedStartMs - nowMs;
  const relativeStartLabel = relativeStartMs > 0
    ? `Starts in ${formatCountdown(relativeStartMs)}`
    : relativeStartMs < 0
      ? `Started ${formatCountdown(Math.abs(relativeStartMs))} ago`
      : 'Starts now';

  if (!countdown) {
    return {
      tone: 'normal',
      kicker: 'Task Window',
      title: `${describeDuration(draftDurationMs)} block`,
      detail: relativeStartLabel,
    };
  }

  const sessionStartMs = Date.parse(countdown.startedAt);
  const sessionEndMs = Date.parse(countdown.targetAt);

  if (plannedStartMs < sessionStartMs) {
    return {
      tone: 'error',
      kicker: 'Task Window',
      title: 'Starts too early',
      detail: 'Move the task inside the current session window.',
    };
  }

  if (plannedStartMs >= sessionEndMs) {
    return {
      tone: 'error',
      kicker: 'Task Window',
      title: 'Starts after session end',
      detail: 'A task must begin before the global timer ends.',
    };
  }

  const uncappedEndMs = plannedStartMs + draftDurationMs;
  const effectiveEndMs = draftOverflowMode === 'cap'
    ? Math.min(uncappedEndMs, sessionEndMs)
    : uncappedEndMs;

  if (effectiveEndMs <= plannedStartMs) {
    return {
      tone: 'error',
      kicker: 'Task Window',
      title: 'No usable time',
      detail: 'This task would have zero time before the global timer ends.',
    };
  }

  const bleedMs = Math.max(0, uncappedEndMs - sessionEndMs);
  const detail = draftOverflowMode === 'bleed' && bleedMs > 0
    ? `${relativeStartLabel}, ${describeDuration(bleedMs)} bleed`
    : draftOverflowMode === 'cap' && uncappedEndMs > sessionEndMs
      ? `${relativeStartLabel}, capped`
      : relativeStartLabel;

  return {
    tone: 'normal',
    kicker: 'Task Window',
    title: `${describeDuration(effectiveEndMs - plannedStartMs)} block`,
    detail,
  };
}

function reorderTodosForDrop(tasks: TodoTask[], draggedId: string, targetId: string, position: TodoDropPosition) {
  const draggedIndex = tasks.findIndex((task) => task.id === draggedId);
  const targetIndex = tasks.findIndex((task) => task.id === targetId);

  if (draggedIndex === -1 || targetIndex === -1 || draggedId === targetId) {
    return tasks;
  }

  const next = [...tasks];
  const [draggedTask] = next.splice(draggedIndex, 1);
  const insertionIndex = position === 'before' ? targetIndex : targetIndex + 1;
  const adjustedIndex = draggedIndex < insertionIndex ? insertionIndex - 1 : insertionIndex;

  next.splice(adjustedIndex, 0, draggedTask);
  return next;
}

function getTaskStatusTone(timing: TodoTaskTiming): TaskPresentation['statusTone'] {
  if (timing.sessionMissing && timing.status !== 'completed' && timing.status !== 'needs_setup') {
    return 'muted';
  }

  switch (timing.status) {
    case 'active':
    case 'completed':
      return 'warm';
    case 'overdue':
    case 'invalid':
      return 'danger';
    default:
      return 'muted';
  }
}

function getTaskPrimaryMeta(task: TodoTask, timing: TodoTaskTiming) {
  if (timing.status === 'needs_setup') {
    return '';
  }

  if (timing.status === 'invalid') {
    return 'Does not fit this session';
  }

  if (timing.status === 'completed') {
    const completedAt = task.completedAt ?? timing.effectiveEndAt;
    return completedAt ? `Done ${formatTimeLabel(completedAt)}` : 'Done';
  }

  if (timing.sessionMissing) {
    return 'Waiting for session';
  }

  if (timing.status === 'scheduled') {
    return task.plannedStartAt ? `Starts ${formatTimeLabel(task.plannedStartAt)}` : 'Scheduled';
  }

  if (timing.status === 'active') {
    return `${formatCountdown(timing.remainingMs)} left`;
  }

  if (task.actualStartedAt && timing.effectiveEndAt) {
    return `Ended ${formatTimeLabel(timing.effectiveEndAt)}`;
  }

  return 'Session closed';
}

function buildTaskPresentation(task: TodoTask, countdown: CountdownState | null, nowMs: number): TaskPresentation {
  const timing = getTodoTaskTiming(task, countdown, nowMs);

  return {
    task,
    timing,
    statusTone: getTaskStatusTone(timing),
    primaryMeta: getTaskPrimaryMeta(task, timing),
    canStartNow: !timing.sessionMissing && timing.status === 'scheduled',
    showInlineProgress: timing.status !== 'needs_setup' && timing.status !== 'invalid' && !timing.sessionMissing,
  };
}

export function TaskPanel({
  closeSignal,
  countdown,
  now,
  todos,
  onTodosChange,
  onOverlayChange,
  onRequestHideTimerEditor,
}: TaskPanelProps) {
  const [editor, setEditor] = useState<TaskEditorState | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const busyRef = useRef(0);
  const [draggedTodoId, setDraggedTodoId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: TodoDropPosition } | null>(null);

  useEffect(() => {
    onOverlayChange(editor !== null);
  }, [editor, onOverlayChange]);

  useEffect(() => {
    setEditor(null);
    setEditorError(null);
  }, [closeSignal]);

  useEffect(() => {
    if (!editor || editor.mode !== 'edit') {
      return;
    }

    if (!todos.some((task) => task.id === editor.taskId)) {
      setEditor(null);
      setEditorError(null);
    }
  }, [editor, todos]);

  const presentations = useMemo(
    () => todos.map((task) => buildTaskPresentation(task, countdown, now)),
    [todos, countdown, now],
  );
  const hasReachedTodoLimit = todos.length >= MAX_TODO_ITEMS;
  const taskPreview = useMemo(
    () => (editor ? getTaskPreview(editor.form, countdown, editor.timingEnabled, now) : null),
    [editor, countdown, now],
  );
  const currentEditingTask = editor?.mode === 'edit'
    ? presentations.find((item) => item.task.id === editor.taskId) ?? null
    : null;
  const timingButtonLabel = editor
    ? (editor.timingEnabled
      ? (currentEditingTask?.task.actualStartedAt ? 'Stop timer' : 'Remove timing')
      : 'Add timing')
    : 'Add timing';

  const plannedStartDate = editor ? getEditableTaskStart(editor.form, countdown, now) : null;
  const taskDurationTotalMinutes = editor ? getDurationMinutes(editor.form) : 0;
  const durationDisplayLabel = describeDuration(taskDurationTotalMinutes * 60_000);
  const durationPreviousLabel = describeDuration(Math.max(5, taskDurationTotalMinutes - 5) * 60_000);
  const durationNextLabel = describeDuration(Math.max(5, taskDurationTotalMinutes + 5) * 60_000);
  const plannedMonthLabel = plannedStartDate ? MONTH_NAMES[plannedStartDate.getMonth()] : MONTH_NAMES[0];
  const plannedDayLabel = plannedStartDate ? `${plannedStartDate.getDate()}`.padStart(2, '0') : '01';
  const plannedYearLabel = plannedStartDate ? `${plannedStartDate.getFullYear()}` : `${MIN_EDITOR_YEAR}`;
  const plannedHourLabel = plannedStartDate
    ? `${plannedStartDate.getHours() % 12 || 12}`.padStart(2, '0')
    : '12';
  const plannedMinuteLabel = plannedStartDate ? `${plannedStartDate.getMinutes()}`.padStart(2, '0') : '00';
  const previousMonthLabel = editor
    ? MONTH_NAMES[shiftTaskStart(editor.form, countdown, 'month', -1, now).getMonth()]
    : MONTH_NAMES[0];
  const nextMonthLabel = editor
    ? MONTH_NAMES[shiftTaskStart(editor.form, countdown, 'month', 1, now).getMonth()]
    : MONTH_NAMES[0];
  const previousDayLabel = editor
    ? `${shiftTaskStart(editor.form, countdown, 'day', -1, now).getDate()}`.padStart(2, '0')
    : '01';
  const nextDayLabel = editor
    ? `${shiftTaskStart(editor.form, countdown, 'day', 1, now).getDate()}`.padStart(2, '0')
    : '01';
  const previousYearLabel = editor
    ? `${shiftTaskStart(editor.form, countdown, 'year', -1, now).getFullYear()}`
    : `${MIN_EDITOR_YEAR}`;
  const nextYearLabel = editor
    ? `${shiftTaskStart(editor.form, countdown, 'year', 1, now).getFullYear()}`
    : `${MIN_EDITOR_YEAR}`;
  const previousHourDate = editor ? shiftTaskStart(editor.form, countdown, 'hour', -1, now) : null;
  const nextHourDate = editor ? shiftTaskStart(editor.form, countdown, 'hour', 1, now) : null;
  const previousHourLabel = previousHourDate ? `${previousHourDate.getHours() % 12 || 12}`.padStart(2, '0') : '12';
  const nextHourLabel = nextHourDate ? `${nextHourDate.getHours() % 12 || 12}`.padStart(2, '0') : '12';
  const previousMinuteLabel = editor
    ? `${shiftTaskStart(editor.form, countdown, 'minute', -1, now).getMinutes()}`.padStart(2, '0')
    : '00';
  const nextMinuteLabel = editor
    ? `${shiftTaskStart(editor.form, countdown, 'minute', 1, now).getMinutes()}`.padStart(2, '0')
    : '00';

  function startBusy() {
    busyRef.current += 1;
    setIsBusy(true);
  }

  function endBusy() {
    busyRef.current = Math.max(0, busyRef.current - 1);

    if (busyRef.current === 0) {
      setIsBusy(false);
    }
  }

  function openCreate() {
    if (hasReachedTodoLimit) {
      return;
    }

    onRequestHideTimerEditor();
    setTaskError(null);
    setEditorError(null);
    setEditor({
      mode: 'create',
      taskId: null,
      form: buildTaskFormState(null, countdown, Date.now()),
      timingEnabled: false,
    });
  }

  function openEdit(task: TodoTask) {
    onRequestHideTimerEditor();
    setTaskError(null);
    setEditorError(null);
    setEditor({
      mode: 'edit',
      taskId: task.id,
      form: buildTaskFormState(task, countdown, Date.now()),
      timingEnabled: hasTodoTimingConfig(task),
    });
  }

  function updateEditor(updater: (current: TaskFormState) => TaskFormState) {
    setEditor((current) => (
      current
        ? { ...current, form: updater(current.form) }
        : current
    ));
  }

  function setTimingEnabled(enabled: boolean) {
    setEditor((current) => (
      current
        ? { ...current, timingEnabled: enabled }
        : current
    ));
  }

  function applyPlannedStart(date: Date) {
    updateEditor((current) => ({
      ...current,
      ...toExactParts(date),
    }));
  }

  async function saveEditor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editor) {
      return;
    }

    const draft = buildTaskDraft(editor.form, editor.timingEnabled);

    if (!draft) {
      setEditorError(editor.timingEnabled ? 'Fill in the task title, start time, and duration.' : 'Fill in the task title.');
      return;
    }

    startBusy();
    setTaskError(null);
    setEditorError(null);

    try {
      const nextTodos = editor.mode === 'edit' && editor.taskId
        ? await window.countdownWidget.updateTodo(editor.taskId, draft)
        : await window.countdownWidget.createTodo(draft);
      onTodosChange(nextTodos);
      setEditor(null);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : 'Unable to save the task.');
    } finally {
      endBusy();
    }
  }

  async function startTodoNow(id: string) {
    startBusy();
    setTaskError(null);

    try {
      onTodosChange(await window.countdownWidget.startTodoNow(id));
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Unable to start the task.');
    } finally {
      endBusy();
    }
  }

  async function toggleTodo(id: string) {
    startBusy();
    setTaskError(null);

    try {
      onTodosChange(await window.countdownWidget.toggleTodo(id));
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Unable to update the task.');
    } finally {
      endBusy();
    }
  }

  async function removeTodo(id: string) {
    startBusy();
    setTaskError(null);

    try {
      onTodosChange(await window.countdownWidget.removeTodo(id));
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Unable to remove the task.');
    } finally {
      endBusy();
    }
  }

  async function persistTodoOrder(nextTodos: TodoTask[]) {
    const previousTodos = todos;
    onTodosChange(nextTodos);
    startBusy();
    setTaskError(null);

    try {
      onTodosChange(await window.countdownWidget.reorderTodos(nextTodos.map((task) => task.id)));
    } catch (error) {
      onTodosChange(previousTodos);
      setTaskError(error instanceof Error ? error.message : 'Unable to reorder the task.');
    } finally {
      endBusy();
      setDraggedTodoId(null);
      setDropTarget(null);
    }
  }

  return (
    <>
      <section className={`todo-card todo-card-panel ${hasReachedTodoLimit ? 'is-full' : ''}`}>
        <div className="todo-head">
          <div>
            <span className="eyebrow">Tasks</span>
            <span className="todo-count">{todos.length}/{MAX_TODO_ITEMS}</span>
          </div>

          <button
            className="todo-head-button"
            disabled={hasReachedTodoLimit || isBusy}
            onClick={openCreate}
            type="button"
          >
            Add Task
          </button>
        </div>

        <div className={`todo-list ${hasReachedTodoLimit ? 'is-full' : ''}`}>
          {presentations.length > 0 ? (
            presentations.map((presentation) => {
              const progressPercent = `${Math.round(presentation.timing.progress * 100)}%`;

              return (
                <div
                  className={[
                    'todo-item',
                    presentation.task.completed ? 'is-complete' : '',
                    draggedTodoId === presentation.task.id ? 'is-dragging' : '',
                    dropTarget?.id === presentation.task.id ? `is-drop-${dropTarget.position}` : '',
                    `status-${presentation.statusTone}`,
                  ].filter(Boolean).join(' ')}
                  key={presentation.task.id}
                  onDragLeave={(event) => {
                    if (
                      dropTarget?.id === presentation.task.id
                      && !event.currentTarget.contains(event.relatedTarget as Node)
                    ) {
                      setDropTarget(null);
                    }
                  }}
                  onDragOver={(event) => {
                    if (!draggedTodoId || draggedTodoId === presentation.task.id) {
                      return;
                    }

                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const position = event.clientY < bounds.top + (bounds.height / 2) ? 'before' : 'after';
                    setDropTarget({ id: presentation.task.id, position });
                  }}
                  onDrop={(event) => {
                    if (!draggedTodoId || draggedTodoId === presentation.task.id) {
                      setDraggedTodoId(null);
                      setDropTarget(null);
                      return;
                    }

                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const position = event.clientY < bounds.top + (bounds.height / 2) ? 'before' : 'after';
                    const nextTodos = reorderTodosForDrop(todos, draggedTodoId, presentation.task.id, position);

                    if (nextTodos !== todos) {
                      void persistTodoOrder(nextTodos);
                    } else {
                      setDraggedTodoId(null);
                      setDropTarget(null);
                    }
                  }}
                  style={{ ['--task-progress' as string]: progressPercent }}
                >
                  <span
                    aria-label="Drag to reorder"
                    className="todo-grip"
                    draggable={!isBusy}
                    onDragEnd={() => {
                      setDraggedTodoId(null);
                      setDropTarget(null);
                    }}
                    onDragStart={(event) => {
                      if (isBusy) {
                        event.preventDefault();
                        return;
                      }

                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', presentation.task.id);
                      setDraggedTodoId(presentation.task.id);
                      setDropTarget(null);
                    }}
                  />

                  <button
                    aria-label={presentation.task.completed ? 'Mark task incomplete' : 'Mark task complete'}
                    className={`todo-toggle ${presentation.task.completed ? 'is-complete' : ''}`}
                    disabled={isBusy}
                    onClick={() => void toggleTodo(presentation.task.id)}
                    type="button"
                  >
                    <span />
                  </button>

                  <div className={`todo-body ${presentation.primaryMeta ? '' : 'is-title-only'}`.trim()}>
                    <div className="todo-title-row">
                      <span className="todo-title">{presentation.task.title}</span>
                    </div>
                    {presentation.primaryMeta ? (
                      <div className="todo-summary">
                        <p className="todo-meta">{presentation.primaryMeta}</p>
                        {presentation.showInlineProgress ? (
                          <span className="todo-inline-progress" aria-hidden="true">
                            <span className="todo-inline-progress-fill" />
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="todo-actions">
                    {presentation.canStartNow ? (
                      <button
                        className="todo-chip todo-start"
                        disabled={isBusy}
                        onClick={() => void startTodoNow(presentation.task.id)}
                        type="button"
                      >
                        Start
                      </button>
                    ) : null}

                    <button
                      className="todo-chip todo-edit"
                      disabled={isBusy}
                      onClick={() => openEdit(presentation.task)}
                      type="button"
                    >
                      Edit
                    </button>

                    <button
                      aria-label="Remove task"
                      className="todo-remove"
                      disabled={isBusy}
                      onClick={() => void removeTodo(presentation.task.id)}
                      type="button"
                    >
                      <svg aria-hidden="true" className="todo-remove-icon" fill="none" viewBox="0 0 24 24">
                        <path d="M9.25 4.5H14.75" />
                        <path d="M5.5 7H18.5" />
                        <path d="M8 7V17.25C8 18.22 8.78 19 9.75 19H14.25C15.22 19 16 18.22 16 17.25V7" />
                        <path d="M10.5 10.5V15" />
                        <path d="M13.5 10.5V15" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="todo-empty">
              <p>No tasks yet.</p>
              <button className="todo-head-button" onClick={openCreate} type="button">
                Add your first task
              </button>
            </div>
          )}
        </div>

        {taskError ? <p className="todo-error">{taskError}</p> : null}
      </section>

      {editor && plannedStartDate ? (
        <div className="editor-layer task-editor-layer no-drag">
          <form className="editor-card task-editor-card" onSubmit={saveEditor}>
            <div className="editor-grid task-editor-grid">
              <section className="editor-main task-editor-main">
                <div className="plinth-field task-title-field">
                  <span>Task title</span>
                  <input
                    disabled={isBusy}
                    maxLength={60}
                    onChange={(event) => updateEditor((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Name the work block"
                    value={editor.form.title}
                  />
                </div>

                {editor.timingEnabled ? (
                  <>
                    <section className="task-group-card task-start-card">
                      <div className="task-group-head">
                        <span className="eyebrow">Start Time</span>
                        <strong>{formatPlannedStart(plannedStartDate)}</strong>
                      </div>

                      <div className="stepper-grid stepper-grid-three task-start-grid">
                        <ScrubCard
                          disabled={isBusy}
                          label="Month"
                          nextValue={nextMonthLabel}
                          onStep={(delta) => applyPlannedStart(shiftTaskStart(editor.form, countdown, 'month', delta, now))}
                          previousValue={previousMonthLabel}
                          size="compact"
                          value={plannedMonthLabel}
                        />
                        <ScrubCard
                          accent="cool"
                          disabled={isBusy}
                          label="Day"
                          nextValue={nextDayLabel}
                          onStep={(delta) => applyPlannedStart(shiftTaskStart(editor.form, countdown, 'day', delta, now))}
                          previousValue={previousDayLabel}
                          size="compact"
                          value={plannedDayLabel}
                        />
                        <ScrubCard
                          disabled={isBusy}
                          label="Year"
                          nextValue={nextYearLabel}
                          onStep={(delta) => applyPlannedStart(shiftTaskStart(editor.form, countdown, 'year', delta, now))}
                          previousValue={previousYearLabel}
                          size="compact"
                          value={plannedYearLabel}
                        />
                      </div>

                      <div className="stepper-grid stepper-grid-three task-start-grid">
                        <ScrubCard
                          disabled={isBusy}
                          label="Hour"
                          nextValue={nextHourLabel}
                          onStep={(delta) => applyPlannedStart(shiftTaskStart(editor.form, countdown, 'hour', delta, now))}
                          previousValue={previousHourLabel}
                          size="compact"
                          value={plannedHourLabel}
                        />
                        <ScrubCard
                          accent="cool"
                          disabled={isBusy}
                          label="Minute"
                          nextValue={nextMinuteLabel}
                          onStep={(delta) => applyPlannedStart(shiftTaskStart(editor.form, countdown, 'minute', delta, now))}
                          previousValue={previousMinuteLabel}
                          size="compact"
                          value={plannedMinuteLabel}
                        />
                        <div className={`period-card task-start-period ${isBusy ? 'is-disabled' : ''}`}>
                          <span className="stepper-label">Period</span>
                          <div className="period-toggle">
                            <button
                              className={editor.form.period === 'AM' ? 'is-selected' : ''}
                              disabled={isBusy}
                              onClick={() => applyPlannedStart((() => {
                                const next = getEditableTaskStart(editor.form, countdown, now);

                                if (next.getHours() >= 12) {
                                  next.setHours(next.getHours() - 12);
                                }

                                return next;
                              })())}
                              type="button"
                            >
                              AM
                            </button>
                            <button
                              className={editor.form.period === 'PM' ? 'is-selected' : ''}
                              disabled={isBusy}
                              onClick={() => applyPlannedStart((() => {
                                const next = getEditableTaskStart(editor.form, countdown, now);

                                if (next.getHours() < 12) {
                                  next.setHours(next.getHours() + 12);
                                }

                                return next;
                              })())}
                              type="button"
                            >
                              PM
                            </button>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="task-group-card task-duration-card">
                      <div className="task-group-head">
                        <span className="eyebrow">Duration</span>
                        <strong>{durationDisplayLabel}</strong>
                      </div>

                      <div className="preset-grid task-duration-presets">
                        {TASK_DURATION_PRESETS.map((preset) => (
                          <button
                            key={preset.label}
                            className="preset-chip"
                            onClick={() => updateEditor((current) => ({
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

                      <div className="task-duration-scrub">
                        <ScrubCard
                          disabled={isBusy}
                          label="Task length"
                          nextValue={durationNextLabel}
                          onStep={(delta) => updateEditor((current) => ({
                            ...current,
                            ...toDurationParts(Math.max(5, getDurationMinutes(current) + (delta * 5))),
                          }))}
                          previousValue={durationPreviousLabel}
                          size="compact"
                          value={durationDisplayLabel}
                        />
                      </div>
                    </section>
                  </>
                ) : null}

              </section>

              <aside className="editor-aside task-editor-aside">
                {taskPreview ? (
                  <div className={`preview-card ${taskPreview.tone === 'error' ? 'is-error' : ''}`}>
                    <span className="eyebrow">{taskPreview.kicker}</span>
                    <h3>{taskPreview.title}</h3>
                    <p>{taskPreview.detail}</p>
                  </div>
                ) : null}

                {editor.timingEnabled ? (
                  <div className="task-aside-card">
                    <span className="eyebrow">Session End</span>
                    <div className="mode-toggle task-aside-toggle">
                      <button
                        className={editor.form.overflowMode === 'cap' ? 'is-selected' : ''}
                        disabled={isBusy}
                        onClick={() => updateEditor((current) => ({ ...current, overflowMode: 'cap' }))}
                        type="button"
                      >
                        Cap to session
                      </button>
                      <button
                        className={editor.form.overflowMode === 'bleed' ? 'is-selected' : ''}
                        disabled={isBusy}
                        onClick={() => updateEditor((current) => ({ ...current, overflowMode: 'bleed' }))}
                        type="button"
                      >
                        Bleed past end
                      </button>
                    </div>
                  </div>
                ) : null}

                {editorError ? <p className="error-banner">{editorError}</p> : null}

                <div className="task-editor-footer">
                  <button
                    className="action-pill action-pill-secondary action-pill-full task-editor-utility"
                    disabled={isBusy}
                    onClick={() => setTimingEnabled(!editor.timingEnabled)}
                    type="button"
                  >
                    {timingButtonLabel}
                  </button>

                  <div className="editor-actions">
                    <button className="action-pill action-pill-primary action-pill-full" disabled={isBusy} type="submit">
                      {isBusy ? 'Saving...' : editor.mode === 'edit' ? 'Update Task' : 'Create Task'}
                    </button>
                    <button
                      className="action-pill action-pill-secondary action-pill-full"
                      onClick={() => setEditor(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </aside>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
