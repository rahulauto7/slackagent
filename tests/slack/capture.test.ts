import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { captureThread } from '../../src/slack/capture.js';
import { listOpenCommitments } from '../../src/store/commitmentStore.js';
import { FakeLlm } from '../helpers/fakeLlm.js';

const reader = {
  fetchThread: async () => [
    { userId: 'U1', text: 'we are going with stripe' },
    { userId: 'U2', text: "I'll wire the test account by friday" },
  ],
  listMembers: async () => [
    { id: 'U1', name: 'priya', realName: 'Priya N' },
    { id: 'U2', name: 'sam.j', realName: 'Sam Jones' },
  ],
  getPermalink: async () => 'https://x/perma',
};

let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });

describe('captureThread', () => {
  it('stores decisions/commitments with resolved owner and permalink', async () => {
    const llm = new FakeLlm([JSON.stringify({
      decisions: [{ what: 'Use Stripe', rationale: 'cheaper', decided_by: 'Priya N' }],
      commitments: [{ owner: 'Sam', task: 'wire test account', deadline: '2026-07-10' }],
    })]);
    const r = await captureThread(db, llm, reader, 'C1', '111.222');
    expect(r.blocks).toBeTruthy();
    const open = listOpenCommitments(db);
    expect(open[0].owner_user_id).toBe('U2');
    expect(open[0].source_permalink).toBe('https://x/perma');
  });
  it('reports empty result honestly and stores nothing', async () => {
    const llm = new FakeLlm([JSON.stringify({ decisions: [], commitments: [] })]);
    const r = await captureThread(db, llm, reader, 'C1', '111.222');
    expect(r.text).toMatch(/Nothing captured/);
    expect(listOpenCommitments(db)).toHaveLength(0);
  });
  it('refuses politely after double parse failure', async () => {
    const llm = new FakeLlm(['junk', 'junk']);
    const r = await captureThread(db, llm, reader, 'C1', '111.222');
    expect(r.text).toMatch(/couldn't parse/i);
  });
});
