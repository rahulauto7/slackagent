# Task 10: Owner resolution + Block Kit builders

Global constraints: see `00-overview.md`.

**Files:**
- Create: `src/slack/ownerResolution.ts`, `src/slack/blocks.ts`
- Test: `tests/slack/ownerResolution.test.ts`, `tests/slack/blocks.test.ts`

**Interfaces:**
- Consumes: `Decision`, `Commitment`, `isSlackUserId` (Task 02).
- Produces (`ownerResolution.ts`):
  - `type Member = { id: string; name: string; realName: string }`
  - `resolveOwner(raw: string, threadParticipants: Member[], allMembers: Member[]): string` — case-insensitive match on name/realName/first-name, participants take priority; already `<@U...>`-formatted raw → the ID; no match → raw unchanged.
- Produces (`blocks.ts`):
  - `ownerLabel(c: Commitment): string` — `<@U1>` for Slack IDs, plain raw name otherwise
  - `markDoneButton(id: number)` — button, `action_id: 'mark_done'`, `value: String(id)`, text `Mark done ✅`
  - `captureSummaryBlocks(decisions: Decision[], commitments: Commitment[]): any[]` — header + one section per decision (what, rationale) + one section per commitment with `markDoneButton` accessory
  - `nudgeBlocks(c: Commitment): any[]` — reminder text + permalink + `markDoneButton`

- [ ] **Step 1: Write the failing tests**

`tests/slack/ownerResolution.test.ts`:
```ts
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
```

`tests/slack/blocks.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ownerLabel, captureSummaryBlocks, nudgeBlocks } from '../../src/slack/blocks.js';
import type { Commitment, Decision } from '../../src/store/types.js';

const c: Commitment = { id: 7, channel_id: 'C1', owner_user_id: 'U1', task: 'send deck', deadline: '2026-07-10', status: 'open', source_permalink: 'https://x/p', nudge_scheduled_id: null, created_at: '2026-07-06T00:00:00Z' };
const d: Decision = { id: 1, channel_id: 'C1', what: 'Use Stripe', rationale: 'cheaper', decided_by: 'Priya', source_permalink: 'https://x/p', created_at: '2026-07-06T00:00:00Z' };

describe('blocks', () => {
  it('ownerLabel mentions Slack IDs, not raw names', () => {
    expect(ownerLabel(c)).toBe('<@U1>');
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/slack` — Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/slack/ownerResolution.ts`:
```ts
export type Member = { id: string; name: string; realName: string };

function matchIn(raw: string, pool: Member[]): string | null {
  const q = raw.toLowerCase().trim();
  for (const m of pool) {
    const names = [m.name, m.realName, m.realName.split(' ')[0]].map(n => n.toLowerCase());
    if (names.includes(q)) return m.id;
  }
  return null;
}

export function resolveOwner(raw: string, threadParticipants: Member[], allMembers: Member[]): string {
  const mention = raw.match(/^<@([UW][A-Z0-9]+)(\|[^>]*)?>$/);
  if (mention) return mention[1];
  return matchIn(raw, threadParticipants) ?? matchIn(raw, allMembers) ?? raw;
}
```

`src/slack/blocks.ts`:
```ts
import { type Commitment, type Decision, isSlackUserId } from '../store/types.js';

export function ownerLabel(c: Commitment): string {
  return isSlackUserId(c.owner_user_id) ? `<@${c.owner_user_id}>` : c.owner_user_id;
}

export function markDoneButton(id: number) {
  return { type: 'button', action_id: 'mark_done', value: String(id),
           text: { type: 'plain_text', text: 'Mark done ✅' } };
}

const mrkdwn = (text: string) => ({ type: 'section', text: { type: 'mrkdwn', text } });

export function captureSummaryBlocks(decisions: Decision[], commitments: Commitment[]): any[] {
  const blocks: any[] = [mrkdwn(`*Captured* — ${decisions.length} decision(s), ${commitments.length} commitment(s)`)];
  for (const d of decisions)
    blocks.push(mrkdwn(`📌 *${d.what}*${d.rationale ? `\n_Why:_ ${d.rationale}` : ''}`));
  for (const c of commitments)
    blocks.push({ ...mrkdwn(`☑️ ${ownerLabel(c)}: ${c.task}${c.deadline ? ` — due ${c.deadline}` : ' — no deadline'}`),
                  accessory: markDoneButton(c.id) });
  return blocks;
}

export function nudgeBlocks(c: Commitment): any[] {
  return [
    { ...mrkdwn(`⏰ Reminder: *${c.task}* is due ${c.deadline}.\n<${c.source_permalink}|Where you committed>`),
      accessory: markDoneButton(c.id) },
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/slack` — Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/slack tests/slack
git commit -m "feat: owner resolution and Block Kit builders with mark-done buttons"
```
