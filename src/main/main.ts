import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  Tray,
} from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import Store from 'electron-store';
import started from 'electron-squirrel-startup';

import type {
  CountdownStartPayload,
  CountdownState,
  SizePreset,
  TodoTask,
  WindowPrefs,
} from '../shared/contracts';
import {
  SIZE_PRESETS,
  getNotificationBody,
  isSizePreset,
  getTimerDelayMs,
  hydrateStoredCountdownState,
  isValidStartPayload,
} from '../shared/timer';
import {
  MAX_TODO_ITEMS,
  createTodoTask,
  hydrateStoredTodos,
  reorderTodoTasks,
} from '../shared/todo';

const APP_ID = 'com.shees.desktop-countdown-widget';
const TIMER_STATE_CHANNEL = 'timer:state-changed';
const EDITOR_WINDOW_SIZE = SIZE_PRESETS.regular;
const WINDOW_CORNER_RADIUS = 36;
const COMPLETION_HEARTBEAT_MS = 1_000;

type StoreShape = {
  countdown: CountdownState | null;
  todos?: TodoTask[];
  windowPrefs?: WindowPrefs;
};

const store = new Store<StoreShape>({
  defaults: {
    countdown: null,
    todos: [],
  },
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let completionTimer: NodeJS.Timeout | null = null;
let completionHeartbeat: NodeJS.Timeout | null = null;
let isEditingWindow = false;

if (started) {
  app.quit();
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
}

app.setAppUserModelId(APP_ID);

function getTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#75b0ff" />
          <stop offset="100%" stop-color="#ac8aff" />
        </linearGradient>
      </defs>
      <rect x="8" y="6" width="48" height="52" rx="20" fill="rgba(14,14,14,0.86)" />
      <path d="M22 18h20M26 18c0 6 6 8 6 14s-6 8-6 14m12-28c0 6-6 8-6 14s6 8 6 14M22 46h20" stroke="url(#g)" stroke-width="4" stroke-linecap="round"/>
    </svg>
  `.trim();

  return nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
    .resize({ width: 16, height: 16 });
}

function getCurrentCountdownState() {
  const stored = store.get('countdown') ?? null;
  const hydrated = hydrateStoredCountdownState(stored);

  if (!hydrated && stored) {
    store.set('countdown', null);
  }

  return hydrated;
}

function broadcastTimerState() {
  mainWindow?.webContents.send(TIMER_STATE_CHANNEL, getCurrentCountdownState());
}

function getStoredTodos() {
  const normalized = hydrateStoredTodos(store.get('todos'));
  store.set('todos', normalized);
  return normalized;
}

function saveTodos(todos: TodoTask[]) {
  const normalized = hydrateStoredTodos(todos);
  store.set('todos', normalized);
  return normalized;
}

function getDisplayForPoint(x: number, y: number) {
  const displays = screen.getAllDisplays();

  return (
    displays.find((display) => {
      const { x: left, y: top, width, height } = display.workArea;

      return x >= left && x <= left + width && y >= top && y <= top + height;
    }) ?? screen.getPrimaryDisplay()
  );
}

function fitSizeToArea(size: { width: number; height: number }, area: Electron.Rectangle) {
  return {
    width: Math.min(size.width, area.width),
    height: Math.min(size.height, area.height),
  };
}

function getDesiredWindowSize(size: SizePreset, editing: boolean, area: Electron.Rectangle) {
  const desired = editing ? EDITOR_WINDOW_SIZE : SIZE_PRESETS[size];

  return fitSizeToArea(desired, area);
}

function getWindowBounds(prefs: WindowPrefs, editing: boolean) {
  const display = getDisplayForPoint(prefs.x, prefs.y);
  const area = display.workArea;
  const size = getDesiredWindowSize(prefs.size, editing, area);
  const x = Math.min(Math.max(prefs.x, area.x), area.x + area.width - size.width);
  const y = Math.min(Math.max(prefs.y, area.y), area.y + area.height - size.height);

  return {
    x,
    y,
    width: size.width,
    height: size.height,
  };
}

function createRoundedWindowShape(width: number, height: number, radius: number) {
  const safeRadius = Math.max(0, Math.min(radius, Math.floor(Math.min(width, height) / 2)));

  if (safeRadius === 0) {
    return [{ x: 0, y: 0, width, height }];
  }

  const rects: Electron.Rectangle[] = [];
  const centerHeight = Math.max(0, height - (safeRadius * 2));

  if (centerHeight > 0) {
    rects.push({ x: 0, y: safeRadius, width, height: centerHeight });
  }

  for (let y = 0; y < safeRadius; y += 1) {
    const distanceFromCorner = safeRadius - y - 0.5;
    const inset = Math.max(
      0,
      Math.ceil(safeRadius - Math.sqrt((safeRadius * safeRadius) - (distanceFromCorner * distanceFromCorner))),
    );
    const rowWidth = Math.max(0, width - (inset * 2));

    if (rowWidth <= 0) {
      continue;
    }

    rects.push({ x: inset, y, width: rowWidth, height: 1 });
    rects.push({ x: inset, y: height - y - 1, width: rowWidth, height: 1 });
  }

  return rects;
}

function applyWindowShape() {
  if (!mainWindow || process.platform !== 'win32') {
    return;
  }

  const { width, height } = mainWindow.getBounds();
  mainWindow.setShape(createRoundedWindowShape(width, height, WINDOW_CORNER_RADIUS));
}

function applyPinnedWindowLevel() {
  if (!mainWindow) {
    return;
  }

  mainWindow.setAlwaysOnTop(false);
}

function getDefaultWindowPrefs(size: SizePreset): WindowPrefs {
  const display = screen.getPrimaryDisplay();
  const preset = getDesiredWindowSize(size, false, display.workArea);
  const margin = 28;
  const x = display.workArea.x + display.workArea.width - preset.width - margin;
  const y = display.workArea.y + margin;

  return { size, x, y, alwaysOnTop: false };
}

function clampWindowPrefs(prefs: unknown): WindowPrefs {
  const candidate = typeof prefs === 'object' && prefs !== null
    ? prefs as Partial<WindowPrefs>
    : null;
  const size = isSizePreset(candidate?.size) ? candidate.size : 'regular';
  const x = candidate?.x;
  const y = candidate?.y;

  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    return getDefaultWindowPrefs(size);
  }

  const bounds = getWindowBounds(
    {
      size,
      x,
      y,
      alwaysOnTop: false,
    },
    false,
  );

  return {
    size,
    x: bounds.x,
    y: bounds.y,
    alwaysOnTop: false,
  };
}

function getStoredWindowPrefs(): WindowPrefs {
  const normalized = clampWindowPrefs(store.get('windowPrefs'));
  store.set('windowPrefs', normalized);
  return normalized;
}

function persistWindowPrefs() {
  if (!mainWindow) {
    return;
  }

  const [x, y] = mainWindow.getPosition();
  const current = getStoredWindowPrefs();
  const next: WindowPrefs = {
    size: current.size,
    x,
    y,
    alwaysOnTop: false,
  };

  store.set('windowPrefs', clampWindowPrefs(next));
}

function applyWindowBounds(editing: boolean) {
  if (!mainWindow) {
    return;
  }

  const currentPrefs = getStoredWindowPrefs();
  const bounds = getWindowBounds(currentPrefs, editing);

  mainWindow.setBounds(bounds);
  applyWindowShape();
  store.set('windowPrefs', {
    ...currentPrefs,
    x: bounds.x,
    y: bounds.y,
    alwaysOnTop: false,
  });
}

function applyEditingMode(editing: boolean) {
  isEditingWindow = editing;
  applyWindowBounds(editing);
}

function showWindow() {
  if (!mainWindow) {
    return;
  }

  applyWindowShape();
  applyPinnedWindowLevel();

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();
}

function hideWindow() {
  if (!mainWindow) {
    return;
  }

  mainWindow.setAlwaysOnTop(false);
  mainWindow.hide();
}

function showCompletionNotification() {
  const state = getCurrentCountdownState();

  if (!state?.completed || !Notification.isSupported()) {
    return;
  }

  const notification = new Notification({
    title: state.label ? `Finished: ${state.label}` : 'Countdown complete',
    body: getNotificationBody(state),
    silent: false,
  });

  notification.on('click', showWindow);
  notification.show();
}

function clearCompletionTimer() {
  if (!completionTimer) {
    return;
  }

  clearTimeout(completionTimer);
  completionTimer = null;
}

function clearCompletionHeartbeat() {
  if (!completionHeartbeat) {
    return;
  }

  clearInterval(completionHeartbeat);
  completionHeartbeat = null;
}

function clearCompletionMonitors() {
  clearCompletionTimer();
  clearCompletionHeartbeat();
}

function ensureCompletionHeartbeat() {
  if (completionHeartbeat) {
    return;
  }

  completionHeartbeat = setInterval(() => {
    const current = getCurrentCountdownState();

    if (!current) {
      clearCompletionMonitors();
      return;
    }

    if (Date.parse(current.targetAt) <= Date.now()) {
      markCountdownComplete();
    }
  }, COMPLETION_HEARTBEAT_MS);
}

function markCountdownComplete(notify = true) {
  const storedState = store.get('countdown') ?? null;

  if (!storedState) {
    clearCompletionMonitors();
    return;
  }

  const state = hydrateStoredCountdownState(storedState);

  if (!state) {
    store.set('countdown', null);
    clearCompletionMonitors();
    broadcastTimerState();
    return;
  }

  if (Date.parse(state.targetAt) > Date.now()) {
    return;
  }

  if (storedState.completed) {
    clearCompletionMonitors();
    return;
  }

  const nextState = {
    ...state,
    completed: true,
  };

  store.set('countdown', nextState);
  clearCompletionMonitors();
  broadcastTimerState();

  if (notify) {
    showCompletionNotification();
  }
}

function armCompletionTimer() {
  clearCompletionMonitors();

  const state = getCurrentCountdownState();
  const delay = getTimerDelayMs(state);

  if (delay === null) {
    return;
  }

  if (delay <= 0) {
    markCountdownComplete();
    return;
  }

  ensureCompletionHeartbeat();
  completionTimer = setTimeout(() => {
    const current = getCurrentCountdownState();

    if (!current) {
      clearCompletionMonitors();
      return;
    }

    if (Date.parse(current.targetAt) <= Date.now()) {
      markCountdownComplete();
      return;
    }

    armCompletionTimer();
  }, delay);
}

function createTray() {
  tray = new Tray(getTrayIcon());
  tray.setToolTip('Desktop Countdown Widget');

  tray.on('click', showWindow);
  tray.on('double-click', showWindow);

  const menu = Menu.buildFromTemplate([
    { label: 'Show widget', click: showWindow },
    {
      label: 'Reset timer',
      click: async () => {
        store.set('countdown', null);
        clearCompletionMonitors();
        broadcastTimerState();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
}

function loadRenderer(window: BrowserWindow) {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    return;
  }

  void window.loadFile(
    path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
  );
}

function createMainWindow() {
  isEditingWindow = !getCurrentCountdownState();
  const prefs = getStoredWindowPrefs();
  const bounds = getWindowBounds(prefs, isEditingWindow);

  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: false,
    show: false,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    backgroundColor: '#131313',
    title: 'Desktop Countdown Widget',
    autoHideMenuBar: true,
    roundedCorners: false,
    thickFrame: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    applyWindowShape();
    applyPinnedWindowLevel();
    mainWindow?.show();
    broadcastTimerState();
  });

  mainWindow.on('moved', persistWindowPrefs);
  mainWindow.on('move', persistWindowPrefs);
  mainWindow.on('show', () => {
    applyWindowShape();
    applyPinnedWindowLevel();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    hideWindow();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  loadRenderer(mainWindow);
}

function registerIpcHandlers() {
  ipcMain.handle('timer:getState', async () => getCurrentCountdownState());
  ipcMain.handle('todo:getAll', async () => getStoredTodos());

  ipcMain.handle('timer:start', async (_event, payload: CountdownStartPayload) => {
    if (!isValidStartPayload(payload)) {
      throw new Error('Invalid timer payload.');
    }

    const targetMs = Date.parse(payload.targetAt);

    if (targetMs <= Date.now()) {
      throw new Error('Target time must be in the future.');
    }

    const nextState: CountdownState = {
      label: payload.label?.trim() || undefined,
      targetAt: new Date(targetMs).toISOString(),
      startedAt: new Date().toISOString(),
      durationMs: payload.durationMs,
      mode: payload.mode,
      completed: false,
    };

    store.set('countdown', nextState);
    broadcastTimerState();
    armCompletionTimer();
    showWindow();

    return nextState;
  });

  ipcMain.handle('timer:reset', async () => {
    clearCompletionMonitors();
    store.set('countdown', null);
    broadcastTimerState();
  });

  ipcMain.handle('todo:add', async (_event, title: unknown) => {
    const current = getStoredTodos();

    if (current.length >= MAX_TODO_ITEMS) {
      throw new Error('Only 3 tasks allowed.');
    }

    const nextTask = createTodoTask(title, randomUUID());

    if (!nextTask) {
      throw new Error('Enter a task first.');
    }

    return saveTodos([...current, nextTask]);
  });

  ipcMain.handle('todo:reorder', async (_event, orderedIds: unknown) => {
    if (!Array.isArray(orderedIds) || !orderedIds.every((id) => typeof id === 'string')) {
      throw new Error('Invalid task order.');
    }

    return saveTodos(reorderTodoTasks(getStoredTodos(), orderedIds));
  });

  ipcMain.handle('todo:toggle', async (_event, id: unknown) => {
    if (typeof id !== 'string') {
      throw new Error('Invalid task.');
    }

    const current = getStoredTodos();

    return saveTodos(
      current.map((task) => (
        task.id === id
          ? {
              ...task,
              completed: !task.completed,
            }
          : task
      )),
    );
  });

  ipcMain.handle('todo:remove', async (_event, id: unknown) => {
    if (typeof id !== 'string') {
      throw new Error('Invalid task.');
    }

    return saveTodos(getStoredTodos().filter((task) => task.id !== id));
  });

  ipcMain.handle('window:setEditingMode', async (_event, isEditing: boolean) => {
    applyEditingMode(isEditing);
  });

  ipcMain.handle('window:minimizeToTray', async () => {
    hideWindow();
  });

  ipcMain.handle('app:restore', async () => {
    showWindow();
  });

  ipcMain.handle('app:quit', async () => {
    isQuitting = true;
    app.quit();
  });
}

function configureAutoLaunch() {
  if (process.platform !== 'win32' || !app.isPackaged) {
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: true,
    path: process.execPath,
  });
}

if (gotLock) {
  app.on('second-instance', () => {
    showWindow();
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.whenReady().then(() => {
    registerIpcHandlers();
    configureAutoLaunch();
    createTray();
    createMainWindow();

    const hydrated = getCurrentCountdownState();

    if (hydrated?.completed) {
      store.set('countdown', hydrated);
    }

    armCompletionTimer();
  });

  app.on('activate', () => {
    if (!mainWindow) {
      createMainWindow();
      return;
    }

    showWindow();
  });

}
