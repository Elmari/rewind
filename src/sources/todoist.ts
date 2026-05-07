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

function url(cfg: TodoistConfig, key: 'projects' | 'tasks' | 'completed'): string {
  return `${cfg.base_url.replace(/\/$/, '')}${cfg.paths[key]}`;
}

/**
 * Todoist v1 returns `{ results: [...], next_cursor }` for list endpoints,
 * legacy v2/v9 returned arrays directly (or `{ items: [...] }` for completed).
 * Unwrap to a plain array so callers don't care.
 */
function asArray<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === 'object') {
    const obj = res as Record<string, unknown>;
    if (Array.isArray(obj.results)) return obj.results as T[];
    if (Array.isArray(obj.items)) return obj.items as T[];
  }
  return [];
}

export async function fetchTodoist(
  range: DateRange,
  cfg: TodoistConfig,
  apiToken: string,
  ctx: FetchContext,
): Promise<SourceResult> {
  const headers = { authorization: `Bearer ${apiToken}`, accept: 'application/json' };
  const activities: Activity[] = [];

  const projectIds = await resolveProjectIds(cfg, cfg.projects, headers, ctx);
  if (cfg.projects.length > 0 && projectIds.length === 0) {
    ctx.warn(`todoist: no matching projects for ${cfg.projects.join(', ')}`);
    return { source: 'todoist', activities: [] };
  }

  const completedScope = projectIds.length === 0 ? [undefined] : projectIds;
  for (const projectId of completedScope) {
    try {
      const completed = await request<unknown>(url(cfg, 'completed'), {
        headers,
        query: {
          since: range.since.toISOString().replace(/\.\d{3}Z$/, 'Z'),
          until: range.until.toISOString().replace(/\.\d{3}Z$/, 'Z'),
          ...(projectId ? { project_id: projectId } : {}),
          limit: 200,
        },
      });
      const items = asArray<TodoistCompletedItem>(completed);
      const projectsMap =
        completed && typeof completed === 'object' && 'projects' in completed
          ? ((completed as { projects?: Record<string, TodoistProject> }).projects ?? {})
          : {};
      for (const item of items) {
        if (!rangeContains(range, item.completed_at)) continue;
        const projectName = projectsMap[item.project_id]?.name ?? '';
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
      const tasks = asArray<TodoistTask>(await request<unknown>(url(cfg, 'tasks'), { headers }));
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

  const completedCount = activities.filter((a) => a.type === 'task-completed').length;
  const createdCount = activities.filter((a) => a.type === 'task-created').length;
  const sample = activities.slice(0, 3).map((a) => `[${a.type}] ${a.title} (taskId=${a.details?.taskId ?? a.details?.project_id ?? '?'})`).join(' | ');
  ctx.log(`todoist: completed=${completedCount} created=${createdCount}${sample ? ` — sample: ${sample}` : ''}`);

  const open = await fetchTodoistOpen(cfg, headers, projectIds, ctx);
  return { source: 'todoist', activities, open };
}

async function fetchTodoistOpen(
  cfg: TodoistConfig,
  headers: Record<string, string>,
  projectIds: string[],
  ctx: FetchContext,
): Promise<OpenItem[]> {
  try {
    const tasks = asArray<TodoistTask>(await request<unknown>(url(cfg, 'tasks'), { headers }));
    const projectFilter = projectIds.length ? new Set(projectIds) : null;
    const filtered = tasks.filter((t) => !projectFilter || projectFilter.has(t.project_id));
    ctx.log(`todoist: open tasks=${filtered.length} (raw=${tasks.length})${filtered.length ? ` — sample: ${filtered.slice(0, 3).map((t) => `${t.id}:${t.content.slice(0, 60)}`).join(' | ')}` : ''}`);
    return filtered
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
  cfg: TodoistConfig,
  names: string[],
  headers: Record<string, string>,
  ctx: FetchContext,
): Promise<string[]> {
  if (names.length === 0) return [];
  try {
    const projects = asArray<TodoistProject>(await request<unknown>(url(cfg, 'projects'), { headers }));
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
