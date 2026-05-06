export type SourceName =
  | 'jira'
  | 'confluence'
  | 'bitbucket'
  | 'gitlab'
  | 'github'
  | 'git'
  | 'jenkins'
  | 'todoist'
  | 'outlook'
  | 'teams'
  | 'llm';

export interface Activity {
  source: SourceName;
  type: string;
  timestamp: string;
  title: string;
  url?: string;
  details?: Record<string, unknown>;
}

export interface OpenItem {
  source: SourceName;
  type: string; // 'open-issue' | 'open-pr-mine' | 'open-pr-review' | 'open-task' | 'open-mr-mine' | 'open-mr-review'
  title: string;
  url?: string;
  status?: string;
  updated?: string;
  details?: Record<string, unknown>;
}

export interface DateRange {
  since: Date;
  until: Date;
  label: string;
}

export interface SourceResult {
  source: SourceName;
  activities: Activity[];
  open?: OpenItem[];
  error?: string;
}

export interface FetchContext {
  log: (msg: string, extra?: unknown) => void;
  warn: (msg: string, extra?: unknown) => void;
}
