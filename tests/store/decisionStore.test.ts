import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { insertDecision, getDecision, searchDecisions, listDecisionsForChannelsSince } from '../../src/store/decisionStore.js';

let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });

const d1 = { channel_id: 'C1', what: 'Use SQLite for storage', rationale: 'single file, zero ops', decided_by: 'U1', source_permalink: 'https://x/p1' };

describe('decisionStore', () => {
  it('inserts and gets by id', () => {
    const dec = insertDecision(db, d1);
    expect(dec.id).toBeGreaterThan(0);
    expect(getDecision(db, dec.id)?.what).toBe('Use SQLite for storage');
  });
  it('finds via FTS', () => {
    insertDecision(db, d1);
    expect(searchDecisions(db, 'sqlite')).toHaveLength(1);
    expect(searchDecisions(db, 'kubernetes')).toHaveLength(0);
  });
  it('does not throw on FTS operator characters in user input', () => {
    insertDecision(db, d1);
    expect(() => searchDecisions(db, 'what "about - pricing?')).not.toThrow();
    expect(searchDecisions(db, '   ')).toEqual([]);
  });
  it('filters by channel and since', () => {
    const a = insertDecision(db, d1);
    insertDecision(db, { ...d1, channel_id: 'C2' });
    expect(listDecisionsForChannelsSince(db, ['C1'], null).map(r => r.id)).toEqual([a.id]);
    expect(listDecisionsForChannelsSince(db, ['C1'], '2999-01-01T00:00:00Z')).toHaveLength(0);
  });
});
