const ESC = '\x1b[';
const ansi = (open: number, close = 0) => (s: string) => `${ESC}${open}m${s}${ESC}${close}m`;

export const c = {
  red: ansi(31),
  green: ansi(32),
  yellow: ansi(33),
  blue: ansi(34),
  magenta: ansi(35),
  cyan: ansi(36),
  gray: ansi(90),
  bold: ansi(1, 22),
  dim: ansi(2, 22),
  italic: ansi(3, 23),
  underline: ansi(4, 24),
};

export function isTty(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
}

export function strip(s: string): string {
  return s.replace(/\x1b\[\d+m/g, '');
}

export function banner(title: string, subtitle?: string): string {
  const line = c.dim('━'.repeat(36));
  const head = `${c.bold(c.cyan('⏪ ' + title))}${subtitle ? `  ${c.dim('·')}  ${c.gray(subtitle)}` : ''}`;
  return `\n  ${head}\n  ${line}\n`;
}

export function footer(stats: string): string {
  const line = c.dim('─'.repeat(36));
  return `  ${line}\n  ${c.dim(stats)}\n`;
}

export const SOURCE_EMOJI: Record<string, string> = {
  jira: '🎫',
  confluence: '📘',
  bitbucket: '🪣',
  gitlab: '🦊',
  github: '🐙',
  git: '💻',
  jenkins: '🤖',
  todoist: '✅',
  outlook: '📧',
  teams: '💬',
};

export const SOURCE_COLOR: Record<string, (s: string) => string> = {
  jira: c.blue,
  confluence: c.cyan,
  bitbucket: c.blue,
  gitlab: c.magenta,
  github: c.gray,
  git: c.yellow,
  jenkins: c.red,
  todoist: c.green,
  outlook: c.blue,
  teams: c.magenta,
};

export async function spinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!isTty()) return fn();
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const start = Date.now();
  const handle = setInterval(() => {
    process.stderr.write(`\r  ${c.cyan(frames[i++ % frames.length]!)} ${c.dim(label)}`);
  }, 80);
  try {
    const result = await fn();
    clearInterval(handle);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    process.stderr.write(`\r  ${c.green('✓')} ${c.dim(label + ` (${elapsed}s)`)}\n`);
    return result;
  } catch (err) {
    clearInterval(handle);
    process.stderr.write(`\r  ${c.red('✗')} ${c.dim(label)}\n`);
    throw err;
  }
}
