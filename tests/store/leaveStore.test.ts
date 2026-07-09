import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { insertLeave, cancelActiveLeaves, getLeaveCovering, listLeavesOverlapping } from '../../src/store/leaveStore.js';

let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });
const base = { user_id: 'U0AB12CD3', start_date: '2026-07-10', end_date: '2026-07-14', channel_id: 'C1' };

describe('leaveStore', () => {
  it('inserts an active leave with defaults', () => {
    const l = insertLeave(db, base);
    expect(l.status).toBe('active');
    expect(l.start_date).toBe('2026-07-10');
    expect(l.end_date).toBe('2026-07-14');
    expect(l.created_at).toBeTruthy();
  });
  it('getLeaveCovering includes start and end dates, excludes outside', () => {
    insertLeave(db, base);
    expect(getLeaveCovering(db, 'U0AB12CD3', '2026-07-10')).toBeTruthy();
    expect(getLeaveCovering(db, 'U0AB12CD3', '2026-07-14')).toBeTruthy();
    expect(getLeaveCovering(db, 'U0AB12CD3', '2026-07-12')).toBeTruthy();
    expect(getLeaveCovering(db, 'U0AB12CD3', '2026-07-09')).toBeUndefined();
    expect(getLeaveCovering(db, 'U0AB12CD3', '2026-07-15')).toBeUndefined();
    expect(getLeaveCovering(db, 'U9ZZ99ZZ9', '2026-07-12')).toBeUndefined();
  });
  it('cancelActiveLeaves marks active rows cancelled and reports count', () => {
    insertLeave(db, base);
    expect(cancelActiveLeaves(db, 'U0AB12CD3')).toBe(1);
    expect(getLeaveCovering(db, 'U0AB12CD3', '2026-07-12')).toBeUndefined();
    expect(cancelActiveLeaves(db, 'U0AB12CD3')).toBe(0);
  });
  it('listLeavesOverlapping returns active leaves intersecting the window, ordered by start', () => {
    insertLeave(db, base);
    insertLeave(db, { ...base, user_id: 'U9ZZ99ZZ9', start_date: '2026-07-06', end_date: '2026-07-09' });
    insertLeave(db, { ...base, user_id: 'U8YY88YY8', start_date: '2026-08-01', end_date: '2026-08-05' });
    const cancelled = insertLeave(db, { ...base, user_id: 'U7XX77XX7' });
    cancelActiveLeaves(db, cancelled.user_id);
    const got = listLeavesOverlapping(db, '2026-07-09', '2026-07-16');
    expect(got.map(l => l.user_id)).toEqual(['U9ZZ99ZZ9', 'U0AB12CD3']);
  });
});
