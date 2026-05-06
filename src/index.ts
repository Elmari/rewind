#!/usr/bin/env node
import './env.js';
import { Command } from 'commander';
import clipboard from 'clipboardy';
import { loadConfig, writeSampleConfig, defaultConfigPath } from './config.js';
import { resolveRange } from './range.js';
import { ALL_SOURCES, runSources } from './sources/index.js';
import { loginOutlook } from './sources/outlook.js';
import { loginTeams } from './sources/teams.js';
import { renderDoctorReport, runDoctor } from './doctor.js';
import { renderMarkdown, renderMarkdownBody } from './format/markdown.js';
import { renderTerminal, renderTerminalSummary } from './format/terminal.js';
import { condenseForLlm } from './format/condense.js';
import { buildPrompt } from './llm/prompt.js';
import { summarize } from './llm/gemini.js';
import { log } from './log.js';
import { isTty, spinner } from './ui.js';
import type { SourceName, SourceResult } from './types.js';

const program = new Command();
program
  .name('rewind')
  .description('Aggregate yesterday\'s activity for daily-standup prep')
  .version('0.1.0');

program
  .option('--config <path>', 'config file path')
  .option('--today', 'current day (ignore smart yesterday)')
  .option('--date <yyyy-mm-dd>', 'specific day (default: smart yesterday)')
  .option('--since <yyyy-mm-dd>', 'range start')
  .option('--until <yyyy-mm-dd>', 'range end')
  .option(
    '--sources <list>',
    `opt-in subset, comma-separated (${ALL_SOURCES.join(',')})`,
    (v) => v.split(',').map((s) => s.trim()),
  )
  .option(
    '--exclude <list>',
    `opt-out subset, comma-separated (${ALL_SOURCES.join(',')})`,
    (v) => v.split(',').map((s) => s.trim()),
  )
  .option('--no-llm', 'skip LLM summarization, output raw markdown')
  .option('--copy', 'copy result to clipboard', false)
  .option('--refresh', 'bypass cache', false)
  .option('--json', 'emit raw JSON instead of markdown', false)
  .action(async (opts) => {
    await runMain(opts);
  });

program
  .command('config')
  .description('config helpers')
  .command('init')
  .description('write a sample config file')
  .action(() => {
    try {
      const p = writeSampleConfig();
      console.log(`Wrote sample config to ${p}`);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command('doctor')
  .description('verify each enabled source can authenticate and return data')
  .action(async () => {
    const opts = program.opts();
    const { config } = loadConfig(opts.config);
    const results = await runDoctor(config);
    console.log(renderDoctorReport(results));
    if (results.some((r) => r.status === 'fail')) process.exit(1);
  });

program
  .command('login')
  .argument('<service>', 'service to log into (outlook | teams)')
  .description('interactive Microsoft 365 login (device-code flow)')
  .action(async (service: string) => {
    const opts = program.opts();
    const { config } = loadConfig(opts.config);
    if (service === 'outlook') {
      if (!config.sources.outlook) {
        console.error('Outlook is not configured.');
        process.exit(1);
      }
      await loginOutlook(config.sources.outlook);
      console.log('Outlook login OK; tokens cached.');
    } else if (service === 'teams') {
      if (!config.sources.teams) {
        console.error('Teams is not configured.');
        process.exit(1);
      }
      await loginTeams(config.sources.teams);
      console.log('Teams login OK; tokens cached.');
    } else {
      console.error(`Unknown service: ${service} (valid: outlook, teams)`);
      process.exit(1);
    }
  });

interface MainOpts {
  config?: string;
  today: boolean;
  date?: string;
  since?: string;
  until?: string;
  sources?: string[];
  exclude?: string[];
  llm: boolean;
  copy: boolean;
  refresh: boolean;
  json: boolean;
}

async function runMain(opts: MainOpts): Promise<void> {
  let cfg;
  try {
    cfg = loadConfig(opts.config).config;
  } catch (err) {
    console.error((err as Error).message);
    console.error(`Default config path: ${defaultConfigPath()}`);
    process.exit(1);
  }

  const range = resolveRange({
    today: opts.today,
    date: opts.date,
    since: opts.since,
    until: opts.until,
    weekendSkip: cfg.defaults.weekend_skip,
  });

  const selected = resolveSelectedSources(opts.sources, opts.exclude);

  const ctx = {
    log: (m: string, e?: unknown) => (e !== undefined ? log.debug({ extra: e }, m) : log.debug(m)),
    warn: (m: string, e?: unknown) => (e !== undefined ? log.warn({ extra: e }, m) : log.warn(m)),
  };

  const fetchStart = Date.now();
  const results: SourceResult[] = await spinner(`fetching ${selected.length} source(s)`, () =>
    runSources(range, cfg, selected, ctx, {
      useCache: !opts.refresh,
      saveCache: cfg.output.save_to_cache,
      cacheLabel: range.label,
    }),
  );
  const fetchSeconds = (Date.now() - fetchStart) / 1000;

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  let clipboardText: string; // canonical markdown for clipboard / pipe
  let terminalText: string; // fancy version for tty (falls back to markdown if not tty)
  let llmSeconds = 0;

  if (opts.llm) {
    if (!cfg.llm) {
      console.error('No llm config — re-run with --no-llm or set llm in config.');
      process.exit(1);
    }
    const condensed = condenseForLlm(results);
    if (!condensed.hasActivities && !condensed.hasOpen && !condensed.hasAgenda) {
      clipboardText = `# rewind — ${range.label}\n\n_(keine Aktivitäten gefunden)_\n`;
      terminalText = clipboardText;
    } else {
      const prompt = buildPrompt(range, cfg.llm.prompt_language, condensed, opts.today);
      const llmStart = Date.now();
      const summary = await spinner('asking Gemini', () => summarize(prompt, cfg.llm!));
      llmSeconds = (Date.now() - llmStart) / 1000;
      const rawBody = renderMarkdownBody(range, results);
      clipboardText = `# rewind — ${range.label}\n\n${summary}\n\n---\n\n<details><summary>Rohdaten</summary>\n\n${rawBody}\n\n</details>\n`;
      terminalText = isTty()
        ? renderTerminalSummary(range, summary, results, fetchSeconds, llmSeconds)
        : clipboardText;
    }
  } else {
    clipboardText = renderMarkdown(range, results);
    terminalText = isTty() ? renderTerminal(range, results) : clipboardText;
  }

  if (opts.copy) {
    await clipboard.write(clipboardText);
    process.stderr.write('  (in Clipboard kopiert)\n');
  }
  process.stdout.write(terminalText);
  if (!terminalText.endsWith('\n')) process.stdout.write('\n');
}

function resolveSelectedSources(include?: string[], exclude?: string[]): SourceName[] {
  const validate = (list: string[], flag: string): SourceName[] => {
    const unknown = list.filter((s) => !ALL_SOURCES.includes(s as SourceName));
    if (unknown.length) {
      console.error(`Unknown source(s) for ${flag}: ${unknown.join(', ')}. Valid: ${ALL_SOURCES.join(', ')}`);
      process.exit(2);
    }
    return list as SourceName[];
  };
  const base = include?.length ? validate(include, '--sources') : ALL_SOURCES;
  const drop = exclude?.length ? validate(exclude, '--exclude') : [];
  return base.filter((s) => !drop.includes(s));
}

program.parseAsync(process.argv).catch((err) => {
  log.error(err);
  process.exit(1);
});
