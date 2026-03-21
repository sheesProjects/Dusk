import { contextBridge, ipcRenderer } from 'electron';

import type {
  CountdownStartPayload,
  CountdownState,
  CountdownWidgetApi,
} from '../shared/contracts';

const api: CountdownWidgetApi = {
  getState: () => ipcRenderer.invoke('timer:getState') as Promise<CountdownState | null>,
  start: (payload: CountdownStartPayload) =>
    ipcRenderer.invoke('timer:start', payload) as Promise<CountdownState>,
  reset: () => ipcRenderer.invoke('timer:reset') as Promise<void>,
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
