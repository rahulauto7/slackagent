import { describe, it, expect } from 'vitest';
import { extract, ExtractionParseError } from '../../src/extractor/extract.js';
import { FakeLlm } from '../helpers/fakeLlm.js';

const good = JSON.stringify({
  decisions: [{ what: 'Ship v1 Friday', rationale: 'demo deadline', decided_by: 'Priya' }],
  commitments: [{ owner: 'Sam', task: 'send deck', deadline: '2026-07-10' }],
});

describe('extract', () => {
  it('parses valid JSON on first try', async () => {
    const llm = new FakeLlm([good]);
    const r = await extract('thread text', llm);
    expect(r.decisions[0].what).toBe('Ship v1 Friday');
    expect(llm.calls).toHaveLength(1);
  });
  it('strips markdown fences', async () => {
    const llm = new FakeLlm(['```json\n' + good + '\n```']);
    const r = await extract('t', llm);
    expect(r.commitments[0].owner).toBe('Sam');
  });
  it('treats empty arrays as valid (no-decision thread)', async () => {
    const llm = new FakeLlm([JSON.stringify({ decisions: [], commitments: [] })]);
    const r = await extract('t', llm);
    expect(r.decisions).toEqual([]);
  });
  it('retries once with the validation error appended', async () => {
    const llm = new FakeLlm(['{"decisions": "not an array"}', good]);
    const r = await extract('t', llm);
    expect(r.decisions).toHaveLength(1);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].user).toMatch(/decisions/);
  });
  it('throws ExtractionParseError after second failure', async () => {
    const llm = new FakeLlm(['garbage', 'still garbage']);
    await expect(extract('t', llm)).rejects.toThrow(ExtractionParseError);
    expect(llm.calls).toHaveLength(2);
  });
});
