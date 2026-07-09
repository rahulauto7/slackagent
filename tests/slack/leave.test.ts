import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { insertCommitment, getCommitment, setNudgeScheduledId } from '../../src/store/commitmentStore.js';
import { insertLeave, getLeaveCovering } from '../../src/store/leaveStore.js';
import { declareLeave, cancelLeave, whosOut } from '../../src/slack/leave.js';

const now = new Date('2026-07-09T12:00:00');
let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });

const OWNER = 'U0AB12CD3';
const base = { channel_id: 'C1', owner_user_id: OWNER, task: 'send deck', source_permalink: 'https://x/p' };

function fakes() {
  const scheduled: { channel: string; postAt: number; text: string }[] = [];
  const deleted: [string, string][] = [];
  const posts: { channel: string; text: string }[] = [];
  return {
    scheduled, deleted, posts,
    sender: {
      openDm: async (u: string) => `D-${u}`,
      schedule: async (channel: string, postAt: number, text: string) => {
        scheduled.push({ channel, postAt, text }); return `Q${scheduled.length}`;
      },
    },
    messenger: {
      deleteScheduled: async (ch: string, sid: string) => { deleted.push([ch, sid]); },
      post: async (channel: string, text: string) => { posts.push({ channel, text }); },
    },
  };
}
const args = { userId: OWNER, startDate: '2026-07-10', endDate: '2026-07-14', channelId: 'C1' };

describe('declareLeave', () => {
  it('records the leave and replaces any prior active one', async () => {
    insertLeave(db, { user_id: OWNER, start_date: '2026-08-01', end_date: '2026-08-02', channel_id: 'C1' });
    const f = fakes();
    await declareLeave(db, f.sender, f.messenger, args, now);
    expect(getLeaveCovering(db, OWNER, '2026-07-12')).toBeTruthy();
    expect(getLeaveCovering(db, OWNER, '2026-08-01')).toBeUndefined();
  });
  it('moves a due-during-leave nudge to the return morning', async () => {
    const c = insertCommitment(db, { ...base, deadline: '2026-07-11' });
    setNudgeScheduledId(db, c.id, 'D1:Q9');
    const f = fakes();
    await declareLeave(db, f.sender, f.messenger, args, now);
    expect(f.deleted).toEqual([['D1', 'Q9']]);
    expect(f.scheduled).toHaveLength(1);
    const d = new Date(f.scheduled[0].postAt * 1000);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]).toEqual([2026, 7, 15, 9]);
    expect(getCommitment(db, c.id)?.nudge_scheduled_id).toBe(`D-${OWNER}:Q1`);
  });
  it('leaves nudges outside the leave window untouched', async () => {
    const c = insertCommitment(db, { ...base, deadline: '2026-07-20' });
    setNudgeScheduledId(db, c.id, 'D1:Q9');
    const f = fakes();
    await declareLeave(db, f.sender, f.messenger, args, now);
    expect(f.deleted).toHaveLength(0);
    expect(getCommitment(db, c.id)?.nudge_scheduled_id).toBe('D1:Q9');
  });
  it('posts ONE at-risk flag per channel listing commitments due during leave', async () => {
    insertCommitment(db, { ...base, deadline: '2026-07-11' });
    insertCommitment(db, { ...base, deadline: '2026-07-13', task: 'review API spec' });
    insertCommitment(db, { ...base, channel_id: 'C2', deadline: '2026-07-10', task: 'ship fix' });
    insertCommitment(db, { ...base, deadline: '2026-07-20', task: 'later thing' });
    const f = fakes();
    const r = await declareLeave(db, f.sender, f.messenger, args, now);
    expect(f.posts).toHaveLength(2);
    const c1 = f.posts.find(p => p.channel === 'C1')!;
    expect(c1.text).toContain('send deck');
    expect(c1.text).toContain('review API spec');
    expect(c1.text).not.toContain('later thing');
    expect(f.posts.find(p => p.channel === 'C2')!.text).toContain('ship fix');
    expect(r.channels.sort()).toEqual(['C1', 'C2']);
  });
  it('returns a confirmation summarizing moves and flags', async () => {
    const c = insertCommitment(db, { ...base, deadline: '2026-07-11' });
    setNudgeScheduledId(db, c.id, 'D1:Q9');
    const f = fakes();
    const r = await declareLeave(db, f.sender, f.messenger, args, now);
    expect(r.text).toContain('2026-07-10');
    expect(r.text).toContain('2026-07-14');
    expect(r.text).toContain('1 reminder');
    expect(r.text).toContain('2026-07-15');
  });
});

describe('cancelLeave', () => {
  it('cancels the leave and restores a future nudge to its normal time', async () => {
    insertLeave(db, { user_id: OWNER, start_date: '2026-07-10', end_date: '2026-07-14', channel_id: 'C1' });
    const c = insertCommitment(db, { ...base, deadline: '2026-07-20' });
    setNudgeScheduledId(db, c.id, 'D1:Q9');
    const f = fakes();
    const r = await cancelLeave(db, f.sender, f.messenger, OWNER, now);
    expect(getLeaveCovering(db, OWNER, '2026-07-12')).toBeUndefined();
    expect(f.deleted).toEqual([['D1', 'Q9']]);
    const d = new Date(f.scheduled[0].postAt * 1000);
    expect([d.getDate(), d.getHours()]).toEqual([20, 9]);
    expect(r.text).toContain('cancelled');
  });
  it('clears the nudge id when the normal time is already past', async () => {
    insertLeave(db, { user_id: OWNER, start_date: '2026-07-10', end_date: '2026-07-14', channel_id: 'C1' });
    const c = insertCommitment(db, { ...base, deadline: '2026-07-01' });
    setNudgeScheduledId(db, c.id, 'D1:Q9');
    const f = fakes();
    await cancelLeave(db, f.sender, f.messenger, OWNER, now);
    expect(f.scheduled).toHaveLength(0);
    expect(getCommitment(db, c.id)?.nudge_scheduled_id).toBeNull();
  });
  it('reports when there is no active leave', async () => {
    const f = fakes();
    const r = await cancelLeave(db, f.sender, f.messenger, OWNER, now);
    expect(r.text).toMatch(/no active leave/i);
  });
});

describe('whosOut', () => {
  it('lists people out in the next 7 days with commitments due during their leave', () => {
    insertLeave(db, { user_id: OWNER, start_date: '2026-07-10', end_date: '2026-07-14', channel_id: 'C1' });
    insertLeave(db, { user_id: 'U9ZZ99ZZ9', start_date: '2026-08-01', end_date: '2026-08-02', channel_id: 'C1' });
    insertCommitment(db, { ...base, deadline: '2026-07-11' });
    const text = whosOut(db, now);
    expect(text).toContain(`<@${OWNER}>`);
    expect(text).toContain('send deck');
    expect(text).toContain('back 2026-07-15');
    expect(text).not.toContain('U9ZZ99ZZ9');
  });
  it('says so when nobody is out', () => {
    expect(whosOut(db, now)).toMatch(/no one/i);
  });
});
