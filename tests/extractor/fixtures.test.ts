import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('fixture threads', () => {
  const fixtures = JSON.parse(readFileSync('tests/fixtures/threads.json', 'utf8'));
  it('has 10 well-formed fixtures including empty-expectation cases', () => {
    expect(fixtures).toHaveLength(10);
    for (const f of fixtures) {
      expect(f.name).toBeTruthy();
      expect(f.text.length).toBeGreaterThan(20);
      expect(f.expect.minDecisions).toBeGreaterThanOrEqual(0);
    }
    expect(fixtures.filter((f: any) => f.expect.empty)).toHaveLength(2);
  });
});
