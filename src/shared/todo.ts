import type { TodoTask } from './contracts';

export const MAX_TODO_ITEMS = 3;
export const MAX_TODO_TITLE_LENGTH = 60;

export function sanitizeTodoTitle(title: unknown): string | null {
  if (typeof title !== 'string') {
    return null;
  }

  const normalized = title.replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, MAX_TODO_TITLE_LENGTH);
}

export function createTodoTask(title: unknown, id: string): TodoTask | null {
  const sanitizedTitle = sanitizeTodoTitle(title);
  const sanitizedId = id.trim();

  if (!sanitizedTitle || !sanitizedId) {
    return null;
  }

  return {
    id: sanitizedId,
    title: sanitizedTitle,
    completed: false,
  };
}

export function hydrateStoredTodos(value: unknown): TodoTask[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const hydrated: TodoTask[] = [];

  for (const item of value) {
    if (hydrated.length >= MAX_TODO_ITEMS) {
      break;
    }

    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const candidate = item as Partial<TodoTask>;
    const title = sanitizeTodoTitle(candidate.title);
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';

    if (!title || !id) {
      continue;
    }

    hydrated.push({
      id,
      title,
      completed: candidate.completed === true,
    });
  }

  return hydrated;
}

export function reorderTodoTasks(tasks: TodoTask[], orderedIds: string[]): TodoTask[] {
  if (orderedIds.length !== tasks.length) {
    return tasks;
  }

  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const reordered: TodoTask[] = [];

  for (const id of orderedIds) {
    const task = taskMap.get(id);

    if (!task) {
      return tasks;
    }

    reordered.push(task);
    taskMap.delete(id);
  }

  if (taskMap.size > 0) {
    return tasks;
  }

  return reordered;
}
