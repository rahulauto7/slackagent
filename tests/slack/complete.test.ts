import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { insertCommitment, setNudgeScheduledId, getCommitment } from '../../src/store/commitmentStore.js';
import { completeCommitment, markBlocksDone } from '../../src/slack/complete.js';
import { captureSummaryBlocks } from '../../src/slack/blocks.js';

let db: Database.Database;
const base = { channel_id: 'C1', owner_user_id: 'U1', task: 'send deck', deadline: '2026-07-10', source_permalink: 'https://x/p' };
beforeEach(() => { db = openDb(':memory:'); });

describe('completeCommitment', () => {
  it('marks done and cancels the pending nudge', async () => {
    const c = insertCommitment(db, base);
    setNudgeScheduledId(db, c.id, 'D42:Q7');
    const deleted: string[] = [];
    const r = await completeCommitment(db, async (ch, id) => { deleted.push(`${ch}:${id}`); }, c.id);
    expect(r.ok).toBe(true);
    expect(getCommitment(db, c.id)?.status).toBe('done');
    expect(deleted).toEqual(['D42:Q7']);
  });
  it('still succeeds when nudge deletion fails (already sent)', async () => {
    const c = insertCommitment(db, base);
    setNudgeScheduledId(db, c.id, 'D42:Q7');
    const r = await completeCommitment(db, async () => { throw new Error('message_not_found'); }, c.id);
    expect(r.ok).toBe(true);
    expect(getCommitment(db, c.id)?.status).toBe('done');
  });
  it('errors on unknown commitment', async () => {
    const r = await completeCommitment(db, async () => {}, 999);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/);
  });
});

describe('markBlocksDone', () => {
  it('replaces the button with a done label', () => {
    const c = insertCommitment(openDb(':memory:'), base);
    const blocks = captureSummaryBlocks([], [c]);
    const out = markBlocksDone(blocks, c.id, 'U9');
    const s = JSON.stringify(out);
    expect(s).toContain('✅ Done (by <@U9>)');
    expect(s).not.toContain('"mark_done"');
  });
});
