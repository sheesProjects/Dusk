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
  TodoTask,
  TodoTaskDraft,
  WindowPrefs,
} from '../shared/contracts';
import {
  WINDOW_SIZE,
  getNotificationBody,
  getTimerDelayMs,
  hydrateStoredCountdownState,
  isValidStartPayload,
} from '../shared/timer';
import {
  MAX_TODO_ITEMS,
  createTodoTask,
  getTodoTaskTiming,
  hydrateStoredTodos,
  reconcileTodoTasks,
  reorderTodoTasks,
  resetTodoRuntimeState,
  sanitizeTodoDraft,
} from '../shared/todo';

const APP_ID = 'com.shees.desktop-countdown-widget';
const TIMER_STATE_CHANNEL = 'timer:state-changed';
const TODO_STATE_CHANNEL = 'todo:state-changed';
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

function reconcileStoredTodos(
  countdown = getCurrentCountdownState(),
  nowMs = Date.now(),
) {
  const hydrated = hydrateStoredTodos(store.get('todos'));
  const reconciled = reconcileTodoTasks(hydrated, countdown, nowMs);

  if (reconciled.changed) {
    store.set('todos', reconciled.todos);
  }

  return reconciled;
}

function broadcastTodos(todos = getStoredTodos()) {
  mainWindow?.webContents.send(TODO_STATE_CHANNEL, todos);
}

function getStoredTodos() {
  return reconcileStoredTodos().todos;
}

function saveTodos(
  todos: TodoTask[],
  countdown = getCurrentCountdownState(),
  nowMs = Date.now(),
) {
  const hydrated = hydrateStoredTodos(todos);
  const reconciled = reconcileTodoTasks(hydrated, countdown, nowMs);
  store.set('todos', reconciled.todos);
  return reconciled.todos;
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

function getDesiredWindowSize(area: Electron.Rectangle) {
  return fitSizeToArea(WINDOW_SIZE, area);
}

function getWindowBounds(prefs: WindowPrefs) {
  const display = getDisplayForPoint(prefs.x, prefs.y);
  const area = display.workArea;
  const size = getDesiredWindowSize(area);
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

function getDefaultWindowPrefs(): WindowPrefs {
  const display = screen.getPrimaryDisplay();
  const windowSize = getDesiredWindowSize(display.workArea);
  const margin = 28;
  const x = display.workArea.x + display.workArea.width - windowSize.width - margin;
  const y = display.workArea.y + margin;

  return { x, y };
}

function clampWindowPrefs(prefs: unknown): WindowPrefs {
  const candidate = typeof prefs === 'object' && prefs !== null
    ? prefs as Partial<WindowPrefs>
    : null;
  const x = candidate?.x;
  const y = candidate?.y;

  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    return getDefaultWindowPrefs();
  }

  const bounds = getWindowBounds({ x, y });

  return { x: bounds.x, y: bounds.y };
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
  store.set('windowPrefs', clampWindowPrefs({ x, y }));
}

function showWindow() {
  if (!mainWindow) {
    return;
  }

  applyWindowShape();

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

  mainWindow.hide();
}

function showCompletionNotification() {
  const state = getCurrentCountdownState();

  if (!state?.completed || !Notification.isSupported()) {
    return;
  }

  const notification = new Notification({
    title: 'Countdown complete',
    body: getNotificationBody(),
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
    const nowMs = Date.now();
    const current = getCurrentCountdownState();
    const reconciledTodos = reconcileStoredTodos(current, nowMs);

    if (reconciledTodos.changed) {
      broadcastTodos(reconciledTodos.todos);
    }

    if (!current) {
      clearCompletionMonitors();
      return;
    }

    if (Date.parse(current.targetAt) <= nowMs) {
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
        const nextTodos = saveTodos(resetTodoRuntimeState(hydrateStoredTodos(store.get('todos'))), null);
        clearCompletionMonitors();
        broadcastTimerState();
        broadcastTodos(nextTodos);
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
  const prefs = getStoredWindowPrefs();
  const bounds = getWindowBounds(prefs);

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
    mainWindow?.show();
    broadcastTimerState();
    broadcastTodos();
  });

  mainWindow.on('moved', persistWindowPrefs);
  mainWindow.on('show', applyWindowShape);

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
      targetAt: new Date(targetMs).toISOString(),
      startedAt: new Date().toISOString(),
      durationMs: payload.durationMs,
      mode: payload.mode,
      completed: false,
    };

    store.set('countdown', nextState);
    const nextTodos = saveTodos(
      resetTodoRuntimeState(hydrateStoredTodos(store.get('todos'))),
      nextState,
    );
    broadcastTimerState();
    broadcastTodos(nextTodos);
    armCompletionTimer();
    showWindow();

    return nextState;
  });

  ipcMain.handle('timer:reset', async () => {
    clearCompletionMonitors();
    store.set('countdown', null);
    const nextTodos = saveTodos(
      resetTodoRuntimeState(hydrateStoredTodos(store.get('todos'))),
      null,
    );
    broadcastTimerState();
    broadcastTodos(nextTodos);
  });

  ipcMain.handle('todo:create', async (_event, draft: TodoTaskDraft) => {
    const current = getStoredTodos();

    if (current.length >= MAX_TODO_ITEMS) {
      throw new Error('Only 3 tasks allowed.');
    }

    const nextTask = createTodoTask(draft, randomUUID());

    if (!nextTask) {
      throw new Error('Enter a valid task configuration.');
    }

    const nextTodos = saveTodos([...current, nextTask]);
    broadcastTodos(nextTodos);
    return nextTodos;
  });

  ipcMain.handle('todo:update', async (_event, id: unknown, draft: TodoTaskDraft) => {
    if (typeof id !== 'string') {
      throw new Error('Invalid task.');
    }

    const sanitizedDraft = sanitizeTodoDraft(draft);

    if (!sanitizedDraft) {
      throw new Error('Enter a valid task configuration.');
    }

    const current = getStoredTodos();
    const existingTask = current.find((task) => task.id === id);

    if (!existingTask) {
      throw new Error('Task not found.');
    }

    const nextTodos = saveTodos(
      current.map((task) => {
        if (task.id !== id) {
          return task;
        }

        const hasTimingConfig = Boolean(
          sanitizedDraft.durationMs
          && sanitizedDraft.plannedStartAt
          && sanitizedDraft.overflowMode,
        );

        if (!hasTimingConfig) {
          return {
            ...task,
            title: sanitizedDraft.title,
            durationMs: undefined,
            overflowMode: undefined,
            startMode: undefined,
            plannedStartAt: undefined,
            actualStartedAt: undefined,
          };
        }

        const plannedStartChanged = sanitizedDraft.plannedStartAt !== task.plannedStartAt;
        const nextActualStartedAt = task.actualStartedAt
          ? (plannedStartChanged ? sanitizedDraft.plannedStartAt : task.actualStartedAt)
          : undefined;

        return {
          ...task,
          title: sanitizedDraft.title,
          durationMs: sanitizedDraft.durationMs,
          overflowMode: sanitizedDraft.overflowMode,
          startMode: 'scheduled',
          plannedStartAt: sanitizedDraft.plannedStartAt,
          actualStartedAt: nextActualStartedAt,
        };
      }),
    );
    broadcastTodos(nextTodos);
    return nextTodos;
  });

  ipcMain.handle('todo:startNow', async (_event, id: unknown) => {
    if (typeof id !== 'string') {
      throw new Error('Invalid task.');
    }

    const countdown = getCurrentCountdownState();

    if (!countdown) {
      throw new Error('Start the global timer first.');
    }

    const current = getStoredTodos();
    const task = current.find((item) => item.id === id);

    if (!task) {
      throw new Error('Task not found.');
    }

    const timing = getTodoTaskTiming(task, countdown, Date.now());

    if (timing.status === 'needs_setup') {
      throw new Error('Set up the task schedule first.');
    }

    if (timing.status === 'invalid') {
      throw new Error(timing.invalidReason ?? 'This task no longer fits the current session.');
    }

    if (timing.status === 'overdue') {
      throw new Error('This task is already overdue.');
    }

    if (timing.status === 'active' || timing.status === 'completed') {
      throw new Error('This task has already started.');
    }

    if (timing.status !== 'scheduled') {
      throw new Error('This task cannot be started right now.');
    }

    const startedAt = new Date().toISOString();
    const nextTodos = saveTodos(
      current.map((item) => (
        item.id === id
          ? {
              ...item,
              actualStartedAt: startedAt,
            }
          : item
      )),
      countdown,
    );
    broadcastTodos(nextTodos);
    return nextTodos;
  });

  ipcMain.handle('todo:reorder', async (_event, orderedIds: unknown) => {
    if (!Array.isArray(orderedIds) || !orderedIds.every((id) => typeof id === 'string')) {
      throw new Error('Invalid task order.');
    }

    const nextTodos = saveTodos(reorderTodoTasks(getStoredTodos(), orderedIds));
    broadcastTodos(nextTodos);
    return nextTodos;
  });

  ipcMain.handle('todo:toggle', async (_event, id: unknown) => {
    if (typeof id !== 'string') {
      throw new Error('Invalid task.');
    }

    const current = getStoredTodos();
    const completedAt = new Date().toISOString();

    const nextTodos = saveTodos(
      current.map((task) => (
        task.id === id
          ? {
              ...task,
              completed: !task.completed,
              completedAt: task.completed ? undefined : completedAt,
            }
          : task
      )),
    );
    broadcastTodos(nextTodos);
    return nextTodos;
  });

  ipcMain.handle('todo:remove', async (_event, id: unknown) => {
    if (typeof id !== 'string') {
      throw new Error('Invalid task.');
    }

    const nextTodos = saveTodos(getStoredTodos().filter((task) => task.id !== id));
    broadcastTodos(nextTodos);
    return nextTodos;
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
