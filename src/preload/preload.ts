import { contextBridge, ipcRenderer } from 'electron';

import type {
  CountdownStartPayload,
  CountdownState,
  CountdownWidgetApi,
  TodoTask,
  TodoTaskDraft,
} from '../shared/contracts';

const api: CountdownWidgetApi = {
  getState: () => ipcRenderer.invoke('timer:getState') as Promise<CountdownState | null>,
  getTodos: () => ipcRenderer.invoke('todo:getAll') as Promise<TodoTask[]>,
  start: (payload: CountdownStartPayload) =>
    ipcRenderer.invoke('timer:start', payload) as Promise<CountdownState>,
  reset: () => ipcRenderer.invoke('timer:reset') as Promise<void>,
  createTodo: (draft: TodoTaskDraft) => ipcRenderer.invoke('todo:create', draft) as Promise<TodoTask[]>,
  updateTodo: (id: string, draft: TodoTaskDraft) =>
    ipcRenderer.invoke('todo:update', id, draft) as Promise<TodoTask[]>,
  startTodoNow: (id: string) => ipcRenderer.invoke('todo:startNow', id) as Promise<TodoTask[]>,
  reorderTodos: (orderedIds: string[]) =>
    ipcRenderer.invoke('todo:reorder', orderedIds) as Promise<TodoTask[]>,
  toggleTodo: (id: string) => ipcRenderer.invoke('todo:toggle', id) as Promise<TodoTask[]>,
  removeTodo: (id: string) => ipcRenderer.invoke('todo:remove', id) as Promise<TodoTask[]>,
  minimizeToTray: () => ipcRenderer.invoke('window:minimizeToTray') as Promise<void>,
  restore: () => ipcRenderer.invoke('app:restore') as Promise<void>,
  quit: () => ipcRenderer.invoke('app:quit') as Promise<void>,
  onTimerStateChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: CountdownState | null) => {
      callback(state);
    };

    ipcRenderer.on('timer:state-changed', listener);

    return () => {
      ipcRenderer.removeListener('timer:state-changed', listener);
    };
  },
  onTodosChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, tasks: TodoTask[]) => {
      callback(tasks);
    };

    ipcRenderer.on('todo:state-changed', listener);

    return () => {
      ipcRenderer.removeListener('todo:state-changed', listener);
    };
  },
};

contextBridge.exposeInMainWorld('countdownWidget', api);
