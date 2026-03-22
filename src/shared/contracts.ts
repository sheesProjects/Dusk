export type TimerMode = 'duration' | 'datetime';
export type TodoStartMode = 'scheduled' | 'manual';
export type TodoOverflowMode = 'cap' | 'bleed';
export type TodoTaskStatus =
  | 'needs_setup'
  | 'scheduled'
  | 'active'
  | 'completed'
  | 'overdue'
  | 'invalid';

export interface CountdownState {
  targetAt: string;
  startedAt: string;
  durationMs?: number;
  mode: TimerMode;
  completed: boolean;
}

export interface TodoTask {
  id: string;
  title: string;
  completed: boolean;
  completedAt?: string;
  durationMs?: number;
  startMode?: TodoStartMode;
  plannedStartAt?: string;
  actualStartedAt?: string;
  overflowMode?: TodoOverflowMode;
}

export interface TodoTaskDraft {
  title: string;
  durationMs?: number;
  plannedStartAt?: string;
  overflowMode?: TodoOverflowMode;
}

export interface CountdownStartPayload {
  mode: TimerMode;
  durationMs?: number;
  targetAt: string;
}

export interface WindowPrefs {
  x: number;
  y: number;
}

export interface CountdownWidgetApi {
  getState: () => Promise<CountdownState | null>;
  getTodos: () => Promise<TodoTask[]>;
  start: (payload: CountdownStartPayload) => Promise<CountdownState>;
  reset: () => Promise<void>;
  createTodo: (draft: TodoTaskDraft) => Promise<TodoTask[]>;
  updateTodo: (id: string, draft: TodoTaskDraft) => Promise<TodoTask[]>;
  startTodoNow: (id: string) => Promise<TodoTask[]>;
  reorderTodos: (orderedIds: string[]) => Promise<TodoTask[]>;
  toggleTodo: (id: string) => Promise<TodoTask[]>;
  removeTodo: (id: string) => Promise<TodoTask[]>;
  minimizeToTray: () => Promise<void>;
  restore: () => Promise<void>;
  quit: () => Promise<void>;
  onTimerStateChanged: (
    callback: (state: CountdownState | null) => void,
  ) => () => void;
  onTodosChanged: (
    callback: (tasks: TodoTask[]) => void,
  ) => () => void;
}
