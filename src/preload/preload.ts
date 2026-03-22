import { contextBridge, ipcRenderer } from 'electron';

import type {
  CountdownStartPayload,
  CountdownState,
  CountdownWidgetApi,
  TodoTask,
} from '../shared/contracts';

const api: CountdownWidgetApi = {
  getState: () => ipcRenderer.invoke('timer:getState') as Promise<CountdownState | null>,
  getTodos: () => ipcRenderer.invoke('todo:getAll') as Promise<TodoTask[]>,
  start: (payload: CountdownStartPayload) =>
    ipcRenderer.invoke('timer:start', payload) as Promise<CountdownState>,
  reset: () => ipcRenderer.invoke('timer:reset') as Promise<void>,
  addTodo: (title: string) => ipcRenderer.invoke('todo:add', title) as Promise<TodoTask[]>,
  reorderTodos: (orderedIds: string[]) =>
    ipcRenderer.invoke('todo:reorder', orderedIds) as Promise<TodoTask[]>,
  toggleTodo: (id: string) => ipcRenderer.invoke('todo:toggle', id) as Promise<TodoTask[]>,
  removeTodo: (id: string) => ipcRenderer.invoke('todo:remove', id) as Promise<TodoTask[]>,
  setEditingMode: (isEditing: boolean) =>
    ipcRenderer.invoke('window:setEditingMode', isEditing) as Promise<void>,
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
};

contextBridge.exposeInMainWorld('countdownWidget', api);
