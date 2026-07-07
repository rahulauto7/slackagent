import { describe, it, expect } from 'vitest';
import { resolveOwner } from '../../src/slack/ownerResolution.js';

const members = [
  { id: 'U1', name: 'sam.j', realName: 'Sam Jones' },
  { id: 'U2', name: 'sarah', realName: 'Sarah Iyer' },
];

describe('resolveOwner', () => {
  it('resolves display name, real name, and first name (case-insensitive)', () => {
    expect(resolveOwner('sam.j', [], members)).toBe('U1');
    expect(resolveOwner('Sam Jones', [], members)).toBe('U1');
    expect(resolveOwner('sam', [], members)).toBe('U1');
  });
  it('prefers thread participants over workspace-wide match', () => {
    const other = { id: 'U9', name: 'sam.k', realName: 'Sam Kim' };
    expect(resolveOwner('sam', [other], members)).toBe('U9');
  });
  it('passes through <@U...> mentions and returns raw when unresolvable', () => {
    expect(resolveOwner('<@U42>', [], members)).toBe('U42');
    expect(resolveOwner('the infra team', [], members)).toBe('the infra team');
  });
});
