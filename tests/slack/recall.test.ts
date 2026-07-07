import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { insertDecision } from '../../src/store/decisionStore.js';
import { isBriefingAsk, recallPrompt, answerRecall } from '../../src/slack/recall.js';
import { FakeLlm } from '../helpers/fakeLlm.js';

let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });

describe('isBriefingAsk', () => {
  it('routes briefing phrasings, not recall questions', () => {
    expect(isBriefingAsk("What's my day?")).toBe(true);
    expect(isBriefingAsk('show my daily briefing')).toBe(true);
    expect(isBriefingAsk('what did we decide about pricing?')).toBe(false);
  });
});

describe('recallPrompt', () => {
  it('includes records, permalinks, and the honesty instruction', () => {
    insertDecision(db, { channel_id: 'C1', what: 'Price at $29', rationale: 'converts fine', decided_by: 'Priya', source_permalink: 'https://x/p9' });
    const { system, user } = recallPrompt('what about pricing?',
      [{ id: 1, channel_id: 'C1', what: 'Price at $29', rationale: 'converts fine', decided_by: 'Priya', source_permalink: 'https://x/p9', created_at: '' }], ['ctx line']);
    expect(system).toMatch(/don't have a recorded decision/i);
    expect(user).toContain('https://x/p9');
    expect(user).toContain('ctx line');
  });
});

describe('answerRecall', () => {
  it('feeds FTS matches to the LLM and returns its answer', async () => {
    insertDecision(db, { channel_id: 'C1', what: 'Price at $29', rationale: 'converts', decided_by: 'Priya', source_permalink: 'https://x/p9' });
    const llm = new FakeLlm(['We decided $29/mo (<https://x/p9|source>).']);
    const ans = await answerRecall(db, llm, 'what did we decide about the price?', async () => []);
    expect(ans).toContain('$29');
    expect(llm.calls[0].user).toContain('Price at $29');
  });
  it('search-context failures degrade gracefully', async () => {
    const llm = new FakeLlm(["I don't have a recorded decision about that."]);
    const ans = await answerRecall(db, llm, 'anything?', async () => { throw new Error('no token'); });
    expect(ans).toMatch(/don't have a recorded decision/);
  });
});
