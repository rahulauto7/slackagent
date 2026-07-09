import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { insertDecision } from '../../src/store/decisionStore.js';
import { insertCommitment, markDone } from '../../src/store/commitmentStore.js';
import { insertLeave } from '../../src/store/leaveStore.js';
import { canvasMarkdown, syncChannelCanvas } from '../../src/slack/canvas.js';

let db: Database.Database;
beforeEach(() => {
  db = openDb(':memory:');
  insertDecision(db, { channel_id: 'C1', what: 'Use Stripe', rationale: 'cheaper', decided_by: 'U1', source_permalink: 'https://x/p' });
  insertCommitment(db, { channel_id: 'C1', owner_user_id: 'U2', task: 'wire account', deadline: '2026-07-10', source_permalink: 'https://x/p' });
});

describe('canvasMarkdown', () => {
  it('shows an Out of office section for owners of open commitments with upcoming leave', () => {
    const now = new Date('2026-07-06T12:00:00');
    insertLeave(db, { user_id: 'U2', start_date: '2026-07-09', end_date: '2026-07-11', channel_id: 'C1' });
    insertLeave(db, { user_id: 'U-elsewhere', start_date: '2026-07-09', end_date: '2026-07-11', channel_id: 'C9' });
    const md = canvasMarkdown(db, 'C1', now);
    expect(md).toContain('Out of office');
    expect(md).toContain('U2 — out 2026-07-09 to 2026-07-11 (back 2026-07-12)');
    expect(md).not.toContain('U-elsewhere');
  });
  it('renders decisions, open and done sections scoped to the channel', () => {
    const done = insertCommitment(db, { channel_id: 'C1', owner_user_id: 'U2', task: 'old task', deadline: null, source_permalink: 'https://x/p' });
    markDone(db, done.id);
    insertDecision(db, { channel_id: 'C2', what: 'Other channel', rationale: '', decided_by: '', source_permalink: '' });
    const md = canvasMarkdown(db, 'C1');
    expect(md).toContain('Use Stripe');
    expect(md).toContain('wire account');
    expect(md).toContain('old task');
    expect(md).not.toContain('Other channel');
  });
});

describe('syncChannelCanvas', () => {
  it('creates once then edits, and never throws on API failure', async () => {
    const calls: string[] = [];
    const canvas = {
      create: async () => { calls.push('create'); return 'F1'; },
      edit: async () => { calls.push('edit'); },
    };
    expect((await syncChannelCanvas(db, canvas, 'C1')).ok).toBe(true);
    expect((await syncChannelCanvas(db, canvas, 'C1')).ok).toBe(true);
    expect(calls).toEqual(['create', 'edit']);
    const broken = { create: async () => { throw new Error('boom'); }, edit: async () => {} };
    const r = await syncChannelCanvas(db, broken, 'C2');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/boom/);
  });
});
