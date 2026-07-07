import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { insertCommitment, getCommitment, listOpenCommitments, markDone, setNudgeScheduledId, flipSlipped, listOwnersWithOpen } from '../../src/store/commitmentStore.js';
import { getLastBriefedAt, setLastBriefedAt } from '../../src/store/userStore.js';

let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });
const base = { channel_id: 'C1', owner_user_id: 'U1', task: 'send deck', source_permalink: 'https://x/p1' };

describe('commitmentStore', () => {
  it('inserts and lists by owner', () => {
    insertCommitment(db, { ...base, deadline: '2026-07-10' });
    insertCommitment(db, { ...base, owner_user_id: 'U2', deadline: null });
    expect(listOpenCommitments(db, 'U1')).toHaveLength(1);
    expect(listOpenCommitments(db)).toHaveLength(2);
  });
  it('markDone works from open and slipped', () => {
    const a = insertCommitment(db, { ...base, deadline: '2020-01-01' });
    flipSlipped(db, '2026-07-06T09:00:00Z');
    expect(getCommitment(db, a.id)?.status).toBe('slipped');
    expect(markDone(db, a.id)?.status).toBe('done');
  });
  it('flipSlipped only touches past-deadline open rows', () => {
    insertCommitment(db, { ...base, deadline: '2020-01-01' });
    insertCommitment(db, { ...base, deadline: '2999-01-01' });
    insertCommitment(db, { ...base, deadline: null });
    expect(flipSlipped(db, '2026-07-06T09:00:00Z')).toBe(1);
  });
  it('stores nudge id', () => {
    const a = insertCommitment(db, { ...base, deadline: '2026-07-10' });
    setNudgeScheduledId(db, a.id, 'Q123');
    expect(getCommitment(db, a.id)?.nudge_scheduled_id).toBe('Q123');
  });
  it('listOwnersWithOpen skips raw-name owners', () => {
    // owner must satisfy the spec regex /^[UW][A-Z0-9]{2,}$/ — 'U1' is too short
    insertCommitment(db, { ...base, owner_user_id: 'U0AB12CD3', deadline: null });
    insertCommitment(db, { ...base, owner_user_id: 'sarah from infra', deadline: null });
    expect(listOwnersWithOpen(db)).toEqual(['U0AB12CD3']);
  });
});

describe('userStore', () => {
  it('upserts last_briefed_at', () => {
    expect(getLastBriefedAt(db, 'U1')).toBeNull();
    setLastBriefedAt(db, 'U1', '2026-07-06T09:00:00Z');
    setLastBriefedAt(db, 'U1', '2026-07-07T09:00:00Z');
    expect(getLastBriefedAt(db, 'U1')).toBe('2026-07-07T09:00:00Z');
  });
});
