import { describe, expect, it } from 'vitest';

import {
  MAX_TODO_ITEMS,
  createTodoTask,
  hydrateStoredTodos,
  reorderTodoTasks,
  sanitizeTodoTitle,
} from './todo';

describe('todo helpers', () => {
  it('sanitizes and trims task titles', () => {
    expect(sanitizeTodoTitle('   Ship   build   tonight   ')).toBe('Ship build tonight');
  });

  it('rejects blank task titles', () => {
    expect(sanitizeTodoTitle('   ')).toBeNull();
    expect(createTodoTask('   ', 'task-1')).toBeNull();
  });

  it('creates a todo task with a stable shape', () => {
    expect(createTodoTask('Write notes', 'task-1')).toEqual({
      id: 'task-1',
      title: 'Write notes',
      completed: false,
    });
  });

  it('hydrates stored todos, dropping invalid items and capping at three', () => {
    expect(
      hydrateStoredTodos([
        { id: '1', title: 'One', completed: false },
        { id: '2', title: 'Two', completed: true },
        { nope: true },
        { id: '3', title: 'Three', completed: false },
        { id: '4', title: 'Four', completed: false },
      ]),
    ).toEqual([
      { id: '1', title: 'One', completed: false },
      { id: '2', title: 'Two', completed: true },
      { id: '3', title: 'Three', completed: false },
    ]);
  });

  it('keeps the hard task limit at three', () => {
    expect(MAX_TODO_ITEMS).toBe(3);
  });

  it('reorders tasks by the provided order', () => {
    expect(
      reorderTodoTasks([
        { id: '1', title: 'One', completed: false },
        { id: '2', title: 'Two', completed: false },
        { id: '3', title: 'Three', completed: false },
      ], ['2', '1', '3']),
    ).toEqual([
      { id: '2', title: 'Two', completed: false },
      { id: '1', title: 'One', completed: false },
      { id: '3', title: 'Three', completed: false },
    ]);
  });
});
