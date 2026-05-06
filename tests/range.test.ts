import { test } from 'node:test';
import assert from 'node:assert/strict';
import { format } from 'date-fns';
import { resolveRange, smartYesterday } from '../src/range.ts';

test('smartYesterday: Tuesday → Monday', () => {
  const tue = new Date('2026-05-05T10:00:00');
  const r = smartYesterday(tue, true);
  assert.equal(format(r, 'yyyy-MM-dd'), '2026-05-04');
});

test('smartYesterday: Monday → previous Friday', () => {
  const mon = new Date('2026-05-04T10:00:00');
  const r = smartYesterday(mon, true);
  assert.equal(format(r, 'yyyy-MM-dd'), '2026-05-01');
});

test('smartYesterday: Sunday → previous Friday', () => {
  const sun = new Date('2026-05-03T10:00:00');
  const r = smartYesterday(sun, true);
  assert.equal(format(r, 'yyyy-MM-dd'), '2026-05-01');
});

test('smartYesterday: Saturday → previous Friday', () => {
  const sat = new Date('2026-05-02T10:00:00');
  const r = smartYesterday(sat, true);
  assert.equal(format(r, 'yyyy-MM-dd'), '2026-05-01');
});

test('smartYesterday: weekend_skip=false on Monday → Sunday', () => {
  const mon = new Date('2026-05-04T10:00:00');
  const r = smartYesterday(mon, false);
  assert.equal(format(r, 'yyyy-MM-dd'), '2026-05-03');
});

test('resolveRange: explicit --date', () => {
  const r = resolveRange({ date: '2026-04-15', now: new Date('2026-05-05') });
  assert.equal(r.label, '2026-04-15');
  assert.equal(format(r.since, 'yyyy-MM-dd HH:mm'), '2026-04-15 00:00');
  assert.equal(format(r.until, 'yyyy-MM-dd HH:mm'), '2026-04-15 23:59');
});

test('resolveRange: --since/--until span', () => {
  const r = resolveRange({ since: '2026-05-01', until: '2026-05-04', now: new Date('2026-05-05') });
  assert.equal(r.label, '2026-05-01..2026-05-04');
});
