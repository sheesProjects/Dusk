export type TimerMode = 'duration' | 'datetime';
export type SizePreset = 'compact' | 'regular' | 'expanded';

export interface CountdownState {
  label?: string;
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
}

export interface CountdownStartPayload {
  label?: string;
  mode: TimerMode;
  durationMs?: number;
  targetAt: string;
}

export interface WindowPrefs {
  size: SizePreset;
  x: number;
  y: number;
  alwaysOnTop: boolean;
}

export interface CountdownWidgetApi {
  getState: () => Promise<CountdownState | null>;
  getTodos: () => Promise<TodoTask[]>;
  start: (payload: CountdownStartPayload) => Promise<CountdownState>;
  reset: () => Promise<void>;
  addTodo: (title: string) => Promise<TodoTask[]>;
  reorderTodos: (orderedIds: string[]) => Promise<TodoTask[]>;
  toggleTodo: (id: string) => Promise<TodoTask[]>;
  removeTodo: (id: string) => Promise<TodoTask[]>;
  setEditingMode: (isEditing: boolean) => Promise<void>;
  minimizeToTray: () => Promise<void>;
  restore: () => Promise<void>;
  quit: () => Promise<void>;
  onTimerStateChanged: (
    callback: (state: CountdownState | null) => void,
  ) => () => void;
}
