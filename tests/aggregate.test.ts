import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateByTicket, extractTicketKey, matchStage } from '../src/format/aggregate.ts';
import type { StageRule } from '../src/config.ts';
import type { SourceResult } from '../src/types.ts';

const stages: StageRule[] = [
  { match: 'feature/*', label: 'TST (Feature-Route)' },
  { match: 'develop', label: 'TST (Sammelroute)' },
  { match: 'master', label: 'ABN' },
];

test('extractTicketKey: matches PROJ-123 in various positions', () => {
  assert.equal(extractTicketKey('PROJ-123: do the thing'), 'PROJ-123');
  assert.equal(extractTicketKey('fix(FOO-9): bla'), 'FOO-9');
  assert.equal(extractTicketKey('feature/PROJ-42-add-cache'), 'PROJ-42');
  assert.equal(extractTicketKey('no key here'), undefined);
  assert.equal(extractTicketKey(undefined), undefined);
});

test('matchStage: prefix glob and exact match', () => {
  assert.equal(matchStage('feature/PROJ-1-x', stages), 'TST (Feature-Route)');
  assert.equal(matchStage('develop', stages), 'TST (Sammelroute)');
  assert.equal(matchStage('master', stages), 'ABN');
  assert.equal(matchStage('hotfix/x', stages), undefined);
  assert.equal(matchStage(undefined, stages), undefined);
});

test('aggregator: pure dev→master merge classifies as mergeOnly + stage promotion', () => {
  const results: SourceResult[] = [
    {
      source: 'bitbucket',
      activities: [
        {
          source: 'bitbucket',
          type: 'pr-merged',
          timestamp: '2026-05-06T10:00:00Z',
          title: 'PROJ/repo #42: PROJ-1234 some change [develop -> master]',
          details: { repo: 'PROJ/repo', prId: 42, from: 'develop', to: 'master' },
        },
      ],
    },
  ];
  const agg = aggregateByTicket(results, stages);
  assert.equal(agg.tickets.length, 1);
  const t = agg.tickets[0];
  assert.equal(t.key, 'PROJ-1234');
  assert.equal(t.hasNewCode, false);
  assert.equal(t.mergeOnly, true);
  assert.deepEqual(t.stagesReachedToday, ['ABN']);
});

test('aggregator: feature PR + commits → hasNewCode true, not mergeOnly', () => {
  const results: SourceResult[] = [
    {
      source: 'bitbucket',
      activities: [
        {
          source: 'bitbucket',
          type: 'pr-opened',
          timestamp: '2026-05-06T09:00:00Z',
          title: 'PROJ/repo #43: PROJ-99 add cache [feature/PROJ-99 -> develop]',
          details: { repo: 'PROJ/repo', prId: 43, from: 'feature/PROJ-99', to: 'develop' },
        },
      ],
    },
    {
      source: 'git',
      activities: [
        {
          source: 'git',
          type: 'commit',
          timestamp: '2026-05-06T08:00:00Z',
          title: 'PROJ-99: add cache layer',
          details: { repo: 'rewind', hash: 'abc12345', email: 'me@x' },
        },
      ],
    },
  ];
  const agg = aggregateByTicket(results, stages);
  const t = agg.tickets.find((x) => x.key === 'PROJ-99');
  assert.ok(t);
  assert.equal(t.hasNewCode, true);
  assert.equal(t.mergeOnly, false);
  assert.equal(t.localCommits.length, 1);
  assert.equal(t.prsOpened.length, 1);
});

test('aggregator: jira issue-touched seeds summary + status', () => {
  const results: SourceResult[] = [
    {
      source: 'jira',
      activities: [
        {
          source: 'jira',
          type: 'issue-touched',
          timestamp: '2026-05-06T07:00:00Z',
          title: 'PROJ-7: Login refactor',
          details: { issue: 'PROJ-7', summary: 'Login refactor', status: 'In Prüfung' },
        },
      ],
    },
  ];
  const agg = aggregateByTicket(results, stages);
  const t = agg.tickets[0];
  assert.equal(t.summary, 'Login refactor');
  assert.equal(t.status, 'In Prüfung');
});

test('aggregator: commits/prs without ticket id land in misc', () => {
  const results: SourceResult[] = [
    {
      source: 'git',
      activities: [
        {
          source: 'git',
          type: 'commit',
          timestamp: '2026-05-06T08:00:00Z',
          title: 'chore: bump deps',
          details: { repo: 'r', hash: 'aaa', email: 'me@x' },
        },
      ],
    },
    {
      source: 'todoist',
      activities: [
        {
          source: 'todoist',
          type: 'task-completed',
          timestamp: '2026-05-06T12:00:00Z',
          title: 'Pay invoice',
        },
      ],
    },
  ];
  const agg = aggregateByTicket(results, stages);
  assert.equal(agg.tickets.length, 0);
  assert.equal(agg.misc.length, 2);
});
