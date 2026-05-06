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

export interface DateRange {
  since: Date;
  until: Date;
  label: string;
}

export interface SourceResult {
  source: SourceName;
  activities: Activity[];
  error?: string;
}

export interface FetchContext {
  log: (msg: string, extra?: unknown) => void;
  warn: (msg: string, extra?: unknown) => void;
}
