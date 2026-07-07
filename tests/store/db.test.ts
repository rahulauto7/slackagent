import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/store/db.js';

describe('openDb', () => {
  it('creates tables and FTS index', () => {
    const db = openDb(':memory:');
    const names = db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','trigger')`).all()
      .map((r: any) => r.name);
    expect(names).toContain('decisions');
    expect(names).toContain('commitments');
    expect(names).toContain('users');
    expect(names).toContain('decisions_fts');
  });
  it('rejects invalid commitment status via CHECK', () => {
    const db = openDb(':memory:');
    expect(() =>
      db.prepare(`INSERT INTO commitments (channel_id, owner_user_id, task, status) VALUES ('C1','U1','t','bogus')`).run()
    ).toThrow(/CHECK/);
  });
});
