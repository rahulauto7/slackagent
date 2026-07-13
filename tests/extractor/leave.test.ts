import { describe, it, expect } from 'vitest';
import { looksLikeLeave, parseLeaveIntent } from '../../src/extractor/leave.js';
import { FakeLlm } from '../helpers/fakeLlm.js';

const now = new Date('2026-07-09T12:00:00');

describe('looksLikeLeave', () => {
  it.each([
    "I'm on leave July 10-14",
    'OOO tomorrow',
    'out of office next week',
    'taking PTO on Friday',
    'on vacation from Monday to Wednesday',
    "who's out this week?",
    'who is out today',
    "I'm back early — cancel my leave",
    'need some time off next week',
    'taking a day off tomorrow',
    "I'm out from the 10th to the 14th",
    'on holiday till Tuesday',
    'i will be leave on from tommorr till firday',
    'I will be out Thursday and Friday',
    "I'll be off next Monday",
    'I will be away all week',
    "I won't be around tomorrow",
    "I won't be available Thu-Fri",
  ])('matches %j', (text) => expect(looksLikeLeave(text)).toBe(true));

  it.each([
    'roll out the feature by Friday',
    'drop off the report at reception',
    "let's kick off the sprint tomorrow",
    'check out the new design',
    'Sarah will send the deck by Thursday',
    'we decided to go with Stripe',
  ])('does not match %j', (text) => expect(looksLikeLeave(text)).toBe(false));
});

describe('parseLeaveIntent', () => {
  it('parses a declare intent and anchors the prompt to today', async () => {
    const llm = new FakeLlm(['{"intent":"declare","start_date":"2026-07-10","end_date":"2026-07-14"}']);
    const r = await parseLeaveIntent("I'm on leave July 10-14", llm, now);
    expect(r).toEqual({ intent: 'declare', start_date: '2026-07-10', end_date: '2026-07-14' });
    expect(llm.calls[0].user).toContain('2026-07-09');
  });
  it('tolerates fenced JSON', async () => {
    const llm = new FakeLlm(['```json\n{"intent":"cancel","start_date":null,"end_date":null}\n```']);
    const r = await parseLeaveIntent("I'm back early, cancel my leave", llm, now);
    expect(r.intent).toBe('cancel');
  });
  it('defaults a missing end date to the start date (single-day leave)', async () => {
    const llm = new FakeLlm(['{"intent":"declare","start_date":"2026-07-10","end_date":null}']);
    const r = await parseLeaveIntent('taking a day off tomorrow', llm, now);
    expect(r.start_date).toBe('2026-07-10');
    expect(r.end_date).toBe('2026-07-10');
  });
  it('retries once on invalid output, then succeeds', async () => {
    const llm = new FakeLlm(['not json at all', '{"intent":"query","start_date":null,"end_date":null}']);
    const r = await parseLeaveIntent("who's out this week?", llm, now);
    expect(r.intent).toBe('query');
    expect(llm.calls).toHaveLength(2);
  });
  it('falls back to intent none when output stays invalid after retry', async () => {
    const llm = new FakeLlm(['nope', 'still nope']);
    const r = await parseLeaveIntent('we rolled out of the meeting', llm, now);
    expect(r).toEqual({ intent: 'none', start_date: null, end_date: null });
  });
});
