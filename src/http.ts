import { Agent, ProxyAgent, fetch as undiciFetch, setGlobalDispatcher } from 'undici';

let initialized = false;

export function initHttp(): void {
  if (initialized) return;
  initialized = true;

  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  if (proxy) {
    setGlobalDispatcher(new ProxyAgent({ uri: proxy }));
  } else {
    setGlobalDispatcher(new Agent({ connectTimeout: 30_000, headersTimeout: 30_000 }));
  }
}

export interface RequestOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
}

export async function request<T = unknown>(url: string, opts: RequestOpts = {}): Promise<T> {
  initHttp();
  const u = new URL(url);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) u.searchParams.set(k, String(v));
    }
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);

  try {
    const res = await undiciFetch(u.toString(), {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body,
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HttpError(res.status, `${opts.method ?? 'GET'} ${u.pathname} → ${res.status}: ${text.slice(0, 500)}`);
    }

    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      return (await res.json()) as T;
    }
    return (await res.text()) as unknown as T;
  } finally {
    clearTimeout(timeout);
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export function basic(username: string, password: string): Record<string, string> {
  const enc = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  return { authorization: `Basic ${enc}` };
}

export type AtlassianAuthMethod = 'bearer' | 'basic';

export function atlassianAuthHeader(
  method: AtlassianAuthMethod,
  pat: string,
  username?: string,
): Record<string, string> {
  if (method === 'basic') {
    if (!username) {
      throw new Error('auth_method=basic requires a username (set identity.<source>_user or identity.atlassian_user)');
    }
    return basic(username, pat);
  }
  return bearer(pat);
}
