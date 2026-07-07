# Task 14: Chase — deadline nudges + weekly digest

Global constraints: see `00-overview.md`.
Spec timing: datetime deadline → nudge 24h before; date-only → 9:00 workspace-local that day. Weekly digest: Mon 9:00 per channel (overdue + due-this-week + no-deadline flags). "Workspace-local" = server TZ for the sandbox demo (set `TZ` when running).

**Files:**
- Create: `src/slack/nudger.ts`
- Modify: `src/slack/capture.ts` (return `commitments`), `src/slack/app.ts` (schedule after capture), `src/index.ts` (cron)
- Test: `tests/slack/nudger.test.ts`

**Interfaces:**
- Consumes: `nudgeBlocks`, `ownerLabel` (10), `setNudgeScheduledId`, `listOpenCommitments` (04), `isSlackUserId` (02).
- Produces (`nudger.ts`):
  - `computeNudgePostAt(deadline: string, now: Date): number | null` — epoch seconds, or null when computed time ≤ now (past deadlines get no nudge; digest catches them)
  - `interface NudgeSender { openDm(userId: string): Promise<string>; schedule(channel: string, postAt: number, text: string, blocks: any[]): Promise<string> }`
  - `scheduleNudge(db, sender: NudgeSender, c: Commitment, now?: Date): Promise<boolean>` — skips raw-name owners / no deadline / past times; on success stores `"<dmChannel>:<scheduledId>"` (Task 13 convention)
  - `buildWeeklyDigest(db, channelId: string, now: Date): string | null` — mrkdwn; null when channel has nothing open
  - `webNudgeSender(client: any): NudgeSender` — `conversations.open`, `chat.scheduleMessage`

- [ ] **Step 1: Write the failing test**

`tests/slack/nudger.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { insertCommitment, getCommitment, flipSlipped } from '../../src/store/commitmentStore.js';
import { computeNudgePostAt, scheduleNudge, buildWeeklyDigest } from '../../src/slack/nudger.js';

const now = new Date('2026-07-06T12:00:00');
let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });
const base = { channel_id: 'C1', owner_user_id: 'U1', task: 'send deck', source_permalink: 'https://x/p' };

describe('computeNudgePostAt', () => {
  it('datetime deadline → 24h before', () => {
    const t = computeNudgePostAt('2026-07-10T15:00', now)!;
    expect(new Date(t * 1000).toISOString().slice(0, 13)).toBe(new Date('2026-07-09T15:00').toISOString().slice(0, 13));
  });
  it('date-only deadline → 9:00 local that day', () => {
    const t = computeNudgePostAt('2026-07-10', now)!;
    const d = new Date(t * 1000);
    expect([d.getHours(), d.getDate()]).toEqual([9, 10]);
  });
  it('past deadline → null', () => {
    expect(computeNudgePostAt('2020-01-01', now)).toBeNull();
  });
});

describe('scheduleNudge', () => {
  const sender = () => {
    const calls: any[] = [];
    return { calls,
      openDm: async (u: string) => `D-${u}`,
      schedule: async (...args: any[]) => { calls.push(args); return 'Q1'; } };
  };
  it('schedules and stores dmChannel:scheduledId', async () => {
    const c = insertCommitment(db, { ...base, deadline: '2026-07-10' });
    const s = sender();
    expect(await scheduleNudge(db, s, c, now)).toBe(true);
    expect(getCommitment(db, c.id)?.nudge_scheduled_id).toBe('D-U1:Q1');
  });
  it('skips raw-name owners and missing deadlines', async () => {
    const s = sender();
    expect(await scheduleNudge(db, s, insertCommitment(db, { ...base, owner_user_id: 'sarah?', deadline: '2026-07-10' }), now)).toBe(false);
    expect(await scheduleNudge(db, s, insertCommitment(db, { ...base, deadline: null }), now)).toBe(false);
    expect(s.calls).toHaveLength(0);
  });
});

describe('buildWeeklyDigest', () => {
  it('lists overdue, due-this-week, and no-deadline; null when empty', () => {
    insertCommitment(db, { ...base, deadline: '2026-07-01' });
    insertCommitment(db, { ...base, deadline: '2026-07-08', task: 'due soon' });
    insertCommitment(db, { ...base, deadline: null, task: 'no deadline task' });
    flipSlipped(db, now.toISOString());
    const md = buildWeeklyDigest(db, 'C1', now)!;
    expect(md).toContain('Overdue');
    expect(md).toContain('due soon');
    expect(md).toContain('no deadline task');
    expect(buildWeeklyDigest(db, 'C-empty', now)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/slack/nudger.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/slack/nudger.ts`**

```ts
import type Database from 'better-sqlite3';
import { type Commitment, isSlackUserId } from '../store/types.js';
import { setNudgeScheduledId } from '../store/commitmentStore.js';
import { nudgeBlocks, ownerLabel } from './blocks.js';

export function computeNudgePostAt(deadline: string, now: Date): number | null {
  const at = deadline.length === 10
    ? new Date(`${deadline}T09:00:00`).getTime()
    : new Date(deadline).getTime() - 24 * 3600 * 1000;
  return at > now.getTime() ? Math.floor(at / 1000) : null;
}

export interface NudgeSender {
  openDm(userId: string): Promise<string>;
  schedule(channel: string, postAt: number, text: string, blocks: any[]): Promise<string>;
}

export function webNudgeSender(client: any): NudgeSender {
  return {
    openDm: async (u) => (await client.conversations.open({ users: u })).channel.id,
    schedule: async (channel, post_at, text, blocks) =>
      (await client.chat.scheduleMessage({ channel, post_at, text, blocks })).scheduled_message_id,
  };
}

export async function scheduleNudge(
  db: Database.Database, sender: NudgeSender, c: Commitment, now: Date = new Date(),
): Promise<boolean> {
  if (!c.deadline || !isSlackUserId(c.owner_user_id)) return false;
  const postAt = computeNudgePostAt(c.deadline, now);
  if (postAt === null) return false;
  const dm = await sender.openDm(c.owner_user_id);
  const id = await sender.schedule(dm, postAt, `Reminder: ${c.task} is due ${c.deadline}`, nudgeBlocks(c));
  setNudgeScheduledId(db, c.id, `${dm}:${id}`);
  return true;
}

export function buildWeeklyDigest(db: Database.Database, channelId: string, now: Date): string | null {
  const rows = db.prepare(`SELECT * FROM commitments WHERE channel_id = ? AND status IN ('open','slipped')`)
    .all(channelId) as Commitment[];
  if (rows.length === 0) return null;
  const weekEnd = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const line = (c: Commitment) => `• ${ownerLabel(c)} — ${c.task}${c.deadline ? ` (due ${c.deadline})` : ''}`;
  const overdue = rows.filter(c => c.status === 'slipped').map(line);
  const dueSoon = rows.filter(c => c.status === 'open' && c.deadline && c.deadline.slice(0, 10) >= today && c.deadline.slice(0, 10) <= weekEnd).map(line);
  const noDeadline = rows.filter(c => !c.deadline).map(line);
  const parts = ['*📋 Weekly FollowThrough digest*'];
  if (overdue.length) parts.push(`*Overdue:*\n${overdue.join('\n')}`);
  if (dueSoon.length) parts.push(`*Due this week:*\n${dueSoon.join('\n')}`);
  if (noDeadline.length) parts.push(`*No deadline set (needs one?):*\n${noDeadline.join('\n')}`);
  return parts.join('\n\n');
}
```

- [ ] **Step 4: Wire into capture and cron**

`src/slack/capture.ts`: add `commitments` to the success return: `return { text, blocks, commitments }` (type `{ text: string; blocks?: any[]; commitments?: Commitment[] }`).
`src/slack/app.ts` `app_mention` handler, after canvas sync: `for (const c of r.commitments ?? []) await scheduleNudge(db, webNudgeSender(client), c);`
`src/index.ts`: after app start:
```ts
import cron from 'node-cron';
import { buildWeeklyDigest } from './slack/nudger.js';
cron.schedule('0 9 * * 1', async () => {
  const channels = db.prepare(`SELECT DISTINCT channel_id FROM commitments WHERE status IN ('open','slipped')`).all() as { channel_id: string }[];
  for (const { channel_id } of channels) {
    const md = buildWeeklyDigest(db, channel_id, new Date());
    if (md) await app.client.chat.postMessage({ channel: channel_id, text: md, token: config.slackBotToken });
  }
});
```

- [ ] **Step 5: Run tests, manual check**

Run: `npx vitest run` — Expected: all pass.
Manual: capture a commitment due tomorrow; `chat.scheduledMessages.list` shows the nudge; clicking Mark done removes it.

- [ ] **Step 6: Commit**

```bash
git add src/slack tests/slack/nudger.test.ts src/index.ts
git commit -m "feat: deadline nudges and weekly digest cron"
```
