import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { insertDecision } from '../../src/store/decisionStore.js';
import { insertCommitment } from '../../src/store/commitmentStore.js';
import { toolSearchDecisions, toolListOpenCommitments, toolGetDecision } from '../../src/mcp/tools.js';

let db: Database.Database;
beforeEach(() => {
  db = openDb(':memory:');
  insertDecision(db, { channel_id: 'C1', what: 'Use Stripe for billing', rationale: 'cheaper', decided_by: 'U1', source_permalink: 'https://x/p1' });
  insertCommitment(db, { channel_id: 'C1', owner_user_id: 'U2', task: 'wire test account', deadline: '2026-07-10', source_permalink: 'https://x/p2' });
});

describe('mcp tools', () => {
  it('search_decisions returns matches with permalinks', () => {
    const out = JSON.parse(toolSearchDecisions(db, 'stripe'));
    expect(out.results).toHaveLength(1);
    expect(out.results[0].source_permalink).toBe('https://x/p1');
  });
  it('list_open_commitments filters by user', () => {
    expect(JSON.parse(toolListOpenCommitments(db)).results).toHaveLength(1);
    expect(JSON.parse(toolListOpenCommitments(db, 'U9')).results).toHaveLength(0);
  });
  it('get_decision returns full record or error', () => {
    expect(JSON.parse(toolGetDecision(db, 1)).what).toBe('Use Stripe for billing');
    expect(JSON.parse(toolGetDecision(db, 999)).error).toMatch(/not found/);
  });
});
