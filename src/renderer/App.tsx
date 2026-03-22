import { useEffect, useMemo, useState } from 'react';

import type { CountdownState, TodoTask } from '../shared/contracts';
import {
  describeDuration,
  formatCountdown,
  formatEditorialTarget,
  getCountdownMetrics,
} from '../shared/timer';
import { TaskPanel } from './TaskPanel';
import { TimerEditor } from './TimerEditor';

export function App() {
  const [countdown, setCountdown] = useState<CountdownState | null>(null);
  const [todos, setTodos] = useState<TodoTask[]>([]);
  const [hasLoadedState, setHasLoadedState] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [timerEditorOpen, setTimerEditorOpen] = useState(false);
  const [taskOverlayOpen, setTaskOverlayOpen] = useState(false);
  const [taskEditorCloseSignal, setTaskEditorCloseSignal] = useState(0);
  useEffect(() => {
    let isMounted = true;

    void Promise.allSettled([
      window.countdownWidget.getState(),
      window.countdownWidget.getTodos(),
    ]).then(([stateResult, todosResult]) => {
      if (!isMounted) {
        return;
      }

      const nextState = stateResult.status === 'fulfilled' ? stateResult.value : null;
      const nextTodos = todosResult.status === 'fulfilled' ? todosResult.value : [];

      setCountdown(nextState);
      setTodos(nextTodos);
      setTimerEditorOpen(!nextState);
      setHasLoadedState(true);
    });

    const removeTimerListener = window.countdownWidget.onTimerStateChanged((state) => {
      if (!isMounted) {
        return;
      }

      setCountdown(state);

      if (!state) {
        setTaskEditorCloseSignal((current) => current + 1);
        setTimerEditorOpen(true);
      }
    });

    const removeTodoListener = window.countdownWidget.onTodosChanged((nextTodos) => {
      if (!isMounted) {
        return;
      }

      setTodos(nextTodos);
    });

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      isMounted = false;
      removeTimerListener();
      removeTodoListener();
      window.clearInterval(intervalId);
    };
  }, []);

  const metrics = useMemo(() => getCountdownMetrics(countdown, now), [countdown, now]);
  const formattedCountdown = metrics.completed ? '00:00' : formatCountdown(metrics.remainingMs);
  const progressPercent = `${Math.round(metrics.progress * 100)}%`;
  const totalLabel = countdown ? describeDuration(metrics.totalMs) : 'Not set';
  const elapsedLabel = countdown ? describeDuration(metrics.elapsedMs) : '0m';
  const targetLabel = countdown ? formatEditorialTarget(new Date(countdown.targetAt)) : 'No target yet';

  return (
    <main className={[
      'widget-shell',
      metrics.completed ? 'is-complete' : '',
      taskOverlayOpen ? 'is-task-editor-open' : '',
    ].filter(Boolean).join(' ')}>
      <header className="widget-header">
        <div className="brand-block drag-strip">
          <p className="eyebrow">Desktop Countdown</p>
          <h1 className="widget-title">Focus Window</h1>
        </div>

        <div className="header-actions no-drag">
          <button
            className="action-pill action-pill-primary"
            onClick={() => {
              setTaskEditorCloseSignal((current) => current + 1);
              setTimerEditorOpen(true);
            }}
            type="button"
          >
            {countdown ? 'Retune Timer' : 'Set Timer'}
          </button>
          <button
            className="action-pill action-pill-secondary"
            onClick={() => void window.countdownWidget.minimizeToTray()}
            type="button"
          >
            Minimize
          </button>
        </div>
      </header>

      <section className="widget-grid">
        <div className="main-stack">
          <section className="hero-well hero-well-main">
            <p className="hero-kicker">Time Left</p>
            <div className="hero-digits">{formattedCountdown}</div>
          </section>

          <TaskPanel
            closeSignal={taskEditorCloseSignal}
            countdown={countdown}
            now={now}
            onOverlayChange={setTaskOverlayOpen}
            onRequestHideTimerEditor={() => setTimerEditorOpen(false)}
            onTodosChange={setTodos}
            todos={todos}
          />
        </div>

        <aside className="insight-panel">
          <div className="progress-dial" style={{ ['--progress' as string]: progressPercent }}>
            <div className="progress-core">
              <span className="eyebrow">Progress</span>
              <strong>{Math.round(metrics.progress * 100)}%</strong>
            </div>
          </div>

          <div className="stat-stack">
            <div className="stat-card">
              <span>Total</span>
              <strong>{totalLabel}</strong>
            </div>
            <div className="stat-card stat-card-cool">
              <span>Elapsed</span>
              <strong>{elapsedLabel}</strong>
            </div>
            <div className="stat-card stat-card-wide">
              <span>Landing</span>
              <strong>{targetLabel}</strong>
            </div>
          </div>

          <button
            className="action-pill action-pill-secondary action-pill-full"
            disabled={!countdown || !hasLoadedState}
            onClick={() => void window.countdownWidget.reset()}
            type="button"
          >
            Reset
          </button>
        </aside>
      </section>

      <TimerEditor
        countdown={countdown}
        now={now}
        onClose={() => setTimerEditorOpen(false)}
        open={hasLoadedState && timerEditorOpen}
      />
    </main>
  );
}
