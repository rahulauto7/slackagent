import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { insertCommitment, getCommitment, flipSlipped } from '../../src/store/commitmentStore.js';
import { computeNudgePostAt, scheduleNudge, buildWeeklyDigest } from '../../src/slack/nudger.js';

const now = new Date('2026-07-06T12:00:00');
let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });
// Deviation from plan: 'U1' fails the spec owner regex /^[UW][A-Z0-9]{2,}$/ — use a valid ID.
const base = { channel_id: 'C1', owner_user_id: 'U0AB12CD3', task: 'send deck', source_permalink: 'https://x/p' };

describe('computeNudgePostAt', () => {
  it('datetime deadline → 24h before', () => {
    const t = computeNudgePostAt('2026-07-10T15:00', now)!;
    expect(new Date(t * 1000).toISOString().slice(0, 13)).toBe(new Date('2026-07-09T15:00').toISOString().slice(0, 13));
  });
  it('date-only deadline → 9:00 local that day', () => {
    const t = computeNudgePostAt('2026-07-10', now)!;
    const d = new Date(t * 1000);
    expect([d.getHours(), d.getDate()]).toEqual([9, 10]);
  });
  it('past deadline → null', () => {
    expect(computeNudgePostAt('2020-01-01', now)).toBeNull();
  });
});

describe('scheduleNudge', () => {
  const sender = () => {
    const calls: any[] = [];
    return { calls,
      openDm: async (u: string) => `D-${u}`,
      schedule: async (...args: any[]) => { calls.push(args); return 'Q1'; } };
  };
  it('schedules and stores dmChannel:scheduledId', async () => {
    const c = insertCommitment(db, { ...base, deadline: '2026-07-10' });
    const s = sender();
    expect(await scheduleNudge(db, s, c, now)).toBe(true);
    expect(getCommitment(db, c.id)?.nudge_scheduled_id).toBe('D-U0AB12CD3:Q1');
  });
  it('skips raw-name owners and missing deadlines', async () => {
    const s = sender();
    expect(await scheduleNudge(db, s, insertCommitment(db, { ...base, owner_user_id: 'sarah?', deadline: '2026-07-10' }), now)).toBe(false);
    expect(await scheduleNudge(db, s, insertCommitment(db, { ...base, deadline: null }), now)).toBe(false);
    expect(s.calls).toHaveLength(0);
  });
});

describe('buildWeeklyDigest', () => {
  it('lists overdue, due-this-week, and no-deadline; null when empty', () => {
    insertCommitment(db, { ...base, deadline: '2026-07-01' });
    insertCommitment(db, { ...base, deadline: '2026-07-08', task: 'due soon' });
    insertCommitment(db, { ...base, deadline: null, task: 'no deadline task' });
    flipSlipped(db, now.toISOString());
    const md = buildWeeklyDigest(db, 'C1', now)!;
    expect(md).toContain('Overdue');
    expect(md).toContain('due soon');
    expect(md).toContain('no deadline task');
    expect(buildWeeklyDigest(db, 'C-empty', now)).toBeNull();
  });
});
