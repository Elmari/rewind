import type { TodoistConfig } from '../config.js';
import { request } from '../http.js';
import { rangeContains } from '../range.js';
import type { Activity, DateRange, FetchContext, OpenItem, SourceResult } from '../types.js';

interface TodoistProject {
  id: string;
  name: string;
}

interface TodoistTask {
  id: string;
  content: string;
  description?: string;
  project_id: string;
  priority: number;
  due?: { date?: string; datetime?: string };
  created_at: string;
}

interface TodoistCompletedItem {
  id: string;
  content: string;
  completed_at: string;
  project_id: string;
  task_id: string;
}

interface TodoistCompletedResponse {
  items: TodoistCompletedItem[];
  projects: Record<string, TodoistProject>;
}

const REST_BASE = 'https://api.todoist.com/rest/v2';
const SYNC_BASE = 'https://api.todoist.com/sync/v9';

export async function fetchTodoist(
  range: DateRange,
  cfg: TodoistConfig,
  apiToken: string,
  ctx: FetchContext,
): Promise<SourceResult> {
  const headers = { authorization: `Bearer ${apiToken}`, accept: 'application/json' };
  const activities: Activity[] = [];

  const projectIds = await resolveProjectIds(cfg.projects, headers, ctx);
  if (cfg.projects.length > 0 && projectIds.length === 0) {
    ctx.warn(`todoist: no matching projects for ${cfg.projects.join(', ')}`);
    return { source: 'todoist', activities: [] };
  }

  const completedScope = projectIds.length === 0 ? [undefined] : projectIds;
  for (const projectId of completedScope) {
    try {
      const completed = await request<TodoistCompletedResponse>(`${SYNC_BASE}/completed/get_all`, {
        headers,
        query: {
          since: range.since.toISOString().replace(/\.\d{3}Z$/, 'Z'),
          until: range.until.toISOString().replace(/\.\d{3}Z$/, 'Z'),
          ...(projectId ? { project_id: projectId } : {}),
          limit: 200,
        },
      });
      for (const item of completed.items) {
        if (!rangeContains(range, item.completed_at)) continue;
        const projectName = completed.projects[item.project_id]?.name ?? '';
        activities.push({
          source: 'todoist',
          type: 'task-completed',
          timestamp: item.completed_at,
          title: projectName ? `${projectName}: ${item.content}` : item.content,
          details: { project: projectName, taskId: item.task_id },
        });
      }
    } catch (err) {
      ctx.warn(`todoist: completed fetch failed${projectId ? ` for project ${projectId}` : ''}`, err);
    }
  }

  if (cfg.include_created) {
    try {
      const tasks = await request<TodoistTask[]>(`${REST_BASE}/tasks`, { headers });
      const projectFilter = projectIds.length ? new Set(projectIds) : null;
      for (const t of tasks) {
        if (projectFilter && !projectFilter.has(t.project_id)) continue;
        if (!rangeContains(range, t.created_at)) continue;
        activities.push({
          source: 'todoist',
          type: 'task-created',
          timestamp: t.created_at,
          title: t.content,
          details: { project_id: t.project_id, priority: t.priority },
        });
      }
    } catch (err) {
      ctx.warn('todoist: open tasks fetch failed', err);
    }
  }

  activities.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const open = await fetchTodoistOpen(headers, projectIds, ctx);
  return { source: 'todoist', activities, open };
}

async function fetchTodoistOpen(
  headers: Record<string, string>,
  projectIds: string[],
  ctx: FetchContext,
): Promise<OpenItem[]> {
  try {
    const tasks = await request<TodoistTask[]>(`${REST_BASE}/tasks`, { headers });
    const projectFilter = projectIds.length ? new Set(projectIds) : null;
    return tasks
      .filter((t) => !projectFilter || projectFilter.has(t.project_id))
      .map((t) => ({
        source: 'todoist' as const,
        type: 'open-task',
        title: t.content,
        url: `https://todoist.com/showTask?id=${t.id}`,
        status: t.due?.date ? `due ${t.due.date}` : undefined,
        updated: t.created_at,
        details: { project_id: t.project_id, priority: t.priority },
      }));
  } catch (err) {
    ctx.warn('todoist: open tasks fetch failed', err);
    return [];
  }
}

async function resolveProjectIds(
  names: string[],
  headers: Record<string, string>,
  ctx: FetchContext,
): Promise<string[]> {
  if (names.length === 0) return [];
  try {
    const projects = await request<TodoistProject[]>(`${REST_BASE}/projects`, { headers });
    const wanted = new Set(names.map((n) => n.toLowerCase()));
    const matched = projects.filter((p) => wanted.has(p.name.toLowerCase()));
    const missing = names.filter((n) => !matched.some((m) => m.name.toLowerCase() === n.toLowerCase()));
    if (missing.length) ctx.warn(`todoist: project(s) not found: ${missing.join(', ')}`);
    return matched.map((p) => p.id);
  } catch (err) {
    ctx.warn('todoist: project resolution failed', err);
    return [];
  }
}
