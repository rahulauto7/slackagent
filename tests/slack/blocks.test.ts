import { describe, it, expect } from 'vitest';
import { ownerLabel, captureSummaryBlocks, nudgeBlocks } from '../../src/slack/blocks.js';
import type { Commitment, Decision } from '../../src/store/types.js';

// owner must satisfy the spec regex /^[UW][A-Z0-9]{2,}$/ — 'U1' is too short
const c: Commitment = { id: 7, channel_id: 'C1', owner_user_id: 'U0AB12CD3', task: 'send deck', deadline: '2026-07-10', status: 'open', source_permalink: 'https://x/p', nudge_scheduled_id: null, created_at: '2026-07-06T00:00:00Z' };
const d: Decision = { id: 1, channel_id: 'C1', what: 'Use Stripe', rationale: 'cheaper', decided_by: 'Priya', source_permalink: 'https://x/p', created_at: '2026-07-06T00:00:00Z' };

describe('blocks', () => {
  it('ownerLabel mentions Slack IDs, not raw names', () => {
    expect(ownerLabel(c)).toBe('<@U0AB12CD3>');
    expect(ownerLabel({ ...c, owner_user_id: 'sarah from infra' })).toBe('sarah from infra');
  });
  it('summary card carries a mark_done button with the commitment id', () => {
    const blocks = captureSummaryBlocks([d], [c]);
    const btn = JSON.stringify(blocks);
    expect(btn).toContain('"action_id":"mark_done"');
    expect(btn).toContain('"value":"7"');
    expect(btn).toContain('Use Stripe');
  });
  it('nudge blocks include permalink and button', () => {
    const s = JSON.stringify(nudgeBlocks(c));
    expect(s).toContain('https://x/p');
    expect(s).toContain('"mark_done"');
  });
});
