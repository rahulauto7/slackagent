# Task 15: Daily Briefing — cron + on-demand

Global constraints: see `00-overview.md`.
Spec: weekday 9:00 workspace-local; flip slipped FIRST; DM only users with open commitments; sections overdue / due today / due this week / decisions since last briefing; LLM "today's focus" line on top; on-demand works even when clear.

**Files:**
- Create: `src/slack/briefing.ts`
- Modify: `src/index.ts` (weekday cron)
- Test: `tests/slack/briefing.test.ts`

**Interfaces:**
- Consumes: `listOpenCommitments`, `flipSlipped`, `listOwnersWithOpen` (04), `listDecisionsForChannelsSince` (03), `get/setLastBriefedAt` (04), `LlmClient` (05), `markDoneButton`, `ownerLabel` (10).
- Produces (`briefing.ts`):
  - `type BriefingSections = { overdue: Commitment[]; dueToday: Commitment[]; dueThisWeek: Commitment[]; decisions: Decision[] }`
  - `buildBriefingSections(db, userId: string, now: Date): BriefingSections` — "this week" = after today, within 7 days; decisions from channels where the user has any commitment, since `last_briefed_at`
  - `composeFocusLine(llm: LlmClient, s: BriefingSections): Promise<string>` — 1–2 sentences; on any LLM error returns static fallback `"Here's your day:"` (log, never fail the briefing)
  - `briefingBlocks(s: BriefingSections, focus: string): any[]` — each commitment row carries `markDoneButton`
  - `onDemandBriefing(db, llm, userId: string, now: Date): Promise<{ text: string; blocks?: any[] }>` — clear users get `"You're clear — no open commitments. 🎉"`
  - `runDailyBriefings(db, llm, sendDm: (userId: string, text: string, blocks: any[]) => Promise<void>, now: Date): Promise<number>` — flips slipped, DMs each owner, records `last_briefed_at`, returns count

- [ ] **Step 1: Write the failing test**

`tests/slack/briefing.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { insertCommitment, flipSlipped } from '../../src/store/commitmentStore.js';
import { insertDecision } from '../../src/store/decisionStore.js';
import { buildBriefingSections, composeFocusLine, onDemandBriefing, runDailyBriefings } from '../../src/slack/briefing.js';
import { FakeLlm } from '../helpers/fakeLlm.js';

const now = new Date('2026-07-06T09:00:00');
let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });
const base = { channel_id: 'C1', owner_user_id: 'U1', source_permalink: 'https://x/p' };

describe('buildBriefingSections', () => {
  it('buckets overdue, today, this week; includes channel decisions', () => {
    insertCommitment(db, { ...base, task: 'late', deadline: '2026-07-01' });
    insertCommitment(db, { ...base, task: 'today', deadline: '2026-07-06' });
    insertCommitment(db, { ...base, task: 'thisweek', deadline: '2026-07-09' });
    insertCommitment(db, { ...base, task: 'far', deadline: '2026-09-01' });
    insertDecision(db, { channel_id: 'C1', what: 'Use Stripe', rationale: '', decided_by: '', source_permalink: '' });
    flipSlipped(db, now.toISOString());
    const s = buildBriefingSections(db, 'U1', now);
    expect(s.overdue.map(c => c.task)).toEqual(['late']);
    expect(s.dueToday.map(c => c.task)).toEqual(['today']);
    expect(s.dueThisWeek.map(c => c.task)).toEqual(['thisweek']);
    expect(s.decisions.map(d => d.what)).toEqual(['Use Stripe']);
  });
});

describe('composeFocusLine', () => {
  it('falls back to a static line on LLM failure', async () => {
    const llm = new FakeLlm([]); // exhausted → throws
    const s = buildBriefingSections(db, 'U1', now);
    expect(await composeFocusLine(llm, s)).toBe("Here's your day:");
  });
});

describe('onDemandBriefing', () => {
  it('returns clear message for users with nothing open', async () => {
    const r = await onDemandBriefing(db, new FakeLlm(['x']), 'U-nobody', now);
    expect(r.text).toMatch(/clear/);
    expect(r.blocks).toBeUndefined();
  });
});

describe('runDailyBriefings', () => {
  it('flips slipped, DMs owners, records last_briefed_at, skips clear users', async () => {
    insertCommitment(db, { ...base, task: 'late', deadline: '2026-07-01' });
    const sent: string[] = [];
    const n = await runDailyBriefings(db, new FakeLlm(['Focus on the late task.']),
      async (u) => { sent.push(u); }, now);
    expect(n).toBe(1);
    expect(sent).toEqual(['U1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/slack/briefing.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/slack/briefing.ts`**

```ts
import type Database from 'better-sqlite3';
import type { Commitment, Decision } from '../store/types.js';
import type { LlmClient } from '../llm/client.js';
import { listOpenCommitments, flipSlipped, listOwnersWithOpen } from '../store/commitmentStore.js';
import { listDecisionsForChannelsSince } from '../store/decisionStore.js';
import { getLastBriefedAt, setLastBriefedAt } from '../store/userStore.js';
import { markDoneButton } from './blocks.js';

export type BriefingSections = { overdue: Commitment[]; dueToday: Commitment[]; dueThisWeek: Commitment[]; decisions: Decision[] };

export function buildBriefingSections(db: Database.Database, userId: string, now: Date): BriefingSections {
  const mine = listOpenCommitments(db, userId);
  const today = now.toISOString().slice(0, 10);
  const weekEnd = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const day = (c: Commitment) => c.deadline?.slice(0, 10) ?? '';
  const channels = [...new Set(mine.map(c => c.channel_id))];
  return {
    overdue: mine.filter(c => c.status === 'slipped'),
    dueToday: mine.filter(c => c.status === 'open' && day(c) === today),
    dueThisWeek: mine.filter(c => c.status === 'open' && day(c) > today && day(c) <= weekEnd),
    decisions: listDecisionsForChannelsSince(db, channels, getLastBriefedAt(db, userId)),
  };
}

export async function composeFocusLine(llm: LlmClient, s: BriefingSections): Promise<string> {
  try {
    const line = await llm.complete(
      'Write ONE short motivating sentence (max 2) summarizing this person\'s work day. Plain text only.',
      JSON.stringify({ overdue: s.overdue.map(c => c.task), dueToday: s.dueToday.map(c => c.task), dueThisWeek: s.dueThisWeek.map(c => c.task) }));
    return line.trim() || "Here's your day:";
  } catch (e) { console.error('focus line failed', e); return "Here's your day:"; }
}

const section = (title: string, rows: Commitment[]) => rows.map(c => ({
  type: 'section',
  text: { type: 'mrkdwn', text: `${title} *${c.task}*${c.deadline ? ` — due ${c.deadline}` : ''}` },
  accessory: markDoneButton(c.id),
}));

export function briefingBlocks(s: BriefingSections, focus: string): any[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `☀️ *Daily Briefing*\n${focus}` } },
    ...section('🔴 Overdue:', s.overdue),
    ...section('🟡 Due today:', s.dueToday),
    ...section('🗓️ This week:', s.dueThisWeek),
    ...s.decisions.map(d => ({ type: 'context', elements: [{ type: 'mrkdwn', text: `📌 Decided: ${d.what}` }] })),
  ];
}

export async function onDemandBriefing(
  db: Database.Database, llm: LlmClient, userId: string, now: Date,
): Promise<{ text: string; blocks?: any[] }> {
  const s = buildBriefingSections(db, userId, now);
  if (!s.overdue.length && !s.dueToday.length && !s.dueThisWeek.length)
    return { text: "You're clear — no open commitments. 🎉" };
  return { text: 'Your daily briefing', blocks: briefingBlocks(s, await composeFocusLine(llm, s)) };
}

export async function runDailyBriefings(
  db: Database.Database, llm: LlmClient,
  sendDm: (userId: string, text: string, blocks: any[]) => Promise<void>, now: Date,
): Promise<number> {
  flipSlipped(db, now.toISOString());
  let count = 0;
  for (const userId of listOwnersWithOpen(db)) {
    const s = buildBriefingSections(db, userId, now);
    await sendDm(userId, 'Your daily briefing', briefingBlocks(s, await composeFocusLine(llm, s)));
    setLastBriefedAt(db, userId, now.toISOString());
    count++;
  }
  return count;
}
```

- [ ] **Step 4: Wire cron in `src/index.ts`**

```ts
import { runDailyBriefings } from './slack/briefing.js';
cron.schedule('0 9 * * 1-5', async () => {
  await runDailyBriefings(db, llm, async (userId, text, blocks) => {
    const dm = await app.client.conversations.open({ users: userId, token: config.slackBotToken });
    await app.client.chat.postMessage({ channel: dm.channel!.id!, text, blocks, token: config.slackBotToken });
  }, new Date());
});
```

- [ ] **Step 5: Run tests, then commit**

Run: `npx vitest run` — Expected: all pass.

```bash
git add src/slack/briefing.ts src/index.ts tests/slack/briefing.test.ts
git commit -m "feat: daily briefing with focus line, cron and on-demand paths"
```
