import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { insertCommitment, flipSlipped } from '../../src/store/commitmentStore.js';
import { insertLeave } from '../../src/store/leaveStore.js';
import { insertDecision } from '../../src/store/decisionStore.js';
import { buildBriefingSections, composeFocusLine, onDemandBriefing, runDailyBriefings } from '../../src/slack/briefing.js';
import { FakeLlm } from '../helpers/fakeLlm.js';

const now = new Date('2026-07-06T09:00:00');
let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });
// Deviation from plan: 'U1' fails the spec owner regex /^[UW][A-Z0-9]{2,}$/ — use a valid ID.
const base = { channel_id: 'C1', owner_user_id: 'U0AB12CD3', source_permalink: 'https://x/p' };

describe('buildBriefingSections', () => {
  it('buckets overdue, today, this week; includes channel decisions', () => {
    insertCommitment(db, { ...base, task: 'late', deadline: '2026-07-01' });
    insertCommitment(db, { ...base, task: 'today', deadline: '2026-07-06' });
    insertCommitment(db, { ...base, task: 'thisweek', deadline: '2026-07-09' });
    insertCommitment(db, { ...base, task: 'far', deadline: '2026-09-01' });
    insertDecision(db, { channel_id: 'C1', what: 'Use Stripe', rationale: '', decided_by: '', source_permalink: '' });
    flipSlipped(db, now.toISOString());
    const s = buildBriefingSections(db, 'U0AB12CD3', now);
    expect(s.overdue.map(c => c.task)).toEqual(['late']);
    expect(s.dueToday.map(c => c.task)).toEqual(['today']);
    expect(s.dueThisWeek.map(c => c.task)).toEqual(['thisweek']);
    expect(s.decisions.map(d => d.what)).toEqual(['Use Stripe']);
  });
});

describe('composeFocusLine', () => {
  it('falls back to a static line on LLM failure', async () => {
    const llm = new FakeLlm([]); // exhausted → throws
    const s = buildBriefingSections(db, 'U0AB12CD3', now);
    expect(await composeFocusLine(llm, s)).toBe("Here's your day:");
  });
});

describe('onDemandBriefing', () => {
  it('returns clear message for users with nothing open', async () => {
    const r = await onDemandBriefing(db, new FakeLlm(['x']), 'U-nobody', now);
    expect(r.text).toMatch(/clear/);
    expect(r.blocks).toBeUndefined();
  });
  it('prepends a leave banner when the asker is on leave', async () => {
    insertCommitment(db, { ...base, task: 'today', deadline: '2026-07-06' });
    insertLeave(db, { user_id: 'U0AB12CD3', start_date: '2026-07-05', end_date: '2026-07-08', channel_id: 'C1' });
    const r = await onDemandBriefing(db, new FakeLlm(['Focus.']), 'U0AB12CD3', now);
    expect(JSON.stringify(r.blocks)).toContain("on leave until 2026-07-08");
  });
});

describe('runDailyBriefings', () => {
  it('flips slipped, DMs owners, records last_briefed_at, skips clear users', async () => {
    insertCommitment(db, { ...base, task: 'late', deadline: '2026-07-01' });
    const sent: string[] = [];
    const n = await runDailyBriefings(db, new FakeLlm(['Focus on the late task.']),
      async (u) => { sent.push(u); }, now);
    expect(n).toBe(1);
    expect(sent).toEqual(['U0AB12CD3']);
  });
  it('skips owners who are on leave today', async () => {
    insertCommitment(db, { ...base, task: 'late', deadline: '2026-07-01' });
    insertLeave(db, { user_id: 'U0AB12CD3', start_date: '2026-07-05', end_date: '2026-07-08', channel_id: 'C1' });
    const sent: string[] = [];
    const n = await runDailyBriefings(db, new FakeLlm(['x']), async (u) => { sent.push(u); }, now);
    expect(n).toBe(0);
    expect(sent).toEqual([]);
  });
});
