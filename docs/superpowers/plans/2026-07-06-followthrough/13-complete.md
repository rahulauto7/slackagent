# Task 13: Complete — mark-done button handler

Global constraints: see `00-overview.md`.
Spec: any workspace member may click; `open → done` and `slipped → done`; nudge deletion is best-effort (already-sent nudge is harmless); canvas re-syncs; source message button becomes "✅ Done (by @who)".

**Files:**
- Create: `src/slack/complete.ts`
- Modify: `src/slack/app.ts` (register `app.action('mark_done')`)
- Test: `tests/slack/complete.test.ts`

**Interfaces:**
- Consumes: `markDone`, `getCommitment` (04), `syncChannelCanvas` (12).
- Convention: `nudge_scheduled_id` stores `"<dmChannelId>:<scheduledMessageId>"` (written in Task 14) because `chat.deleteScheduledMessage` needs both.
- Produces (`complete.ts`):
  - `completeCommitment(db, deleteScheduled: (ch: string, id: string) => Promise<void>, commitmentId: number): Promise<{ ok: boolean; commitment?: Commitment; error?: string }>`
  - `markBlocksDone(blocks: any[], commitmentId: number, byUserId: string): any[]` — pure; strips the matching button, appends `✅ Done (by <@U..>)` to that block's text

- [ ] **Step 1: Write the failing test**

`tests/slack/complete.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/slack/complete.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/slack/complete.ts`**

```ts
import type Database from 'better-sqlite3';
import type { Commitment } from '../store/types.js';
import { getCommitment, markDone } from '../store/commitmentStore.js';

export async function completeCommitment(
  db: Database.Database,
  deleteScheduled: (channel: string, scheduledId: string) => Promise<void>,
  commitmentId: number,
): Promise<{ ok: boolean; commitment?: Commitment; error?: string }> {
  const existing = getCommitment(db, commitmentId);
  if (!existing) return { ok: false, error: `Commitment ${commitmentId} not found` };
  const done = markDone(db, commitmentId)!;
  if (existing.nudge_scheduled_id?.includes(':')) {
    const [channel, scheduledId] = existing.nudge_scheduled_id.split(':', 2);
    try { await deleteScheduled(channel, scheduledId); }
    catch { /* nudge already sent or expired — harmless per spec */ }
  }
  return { ok: true, commitment: done };
}

export function markBlocksDone(blocks: any[], commitmentId: number, byUserId: string): any[] {
  return blocks.map(b => {
    if (b.accessory?.action_id === 'mark_done' && b.accessory?.value === String(commitmentId)) {
      const { accessory, ...rest } = b;
      return { ...rest, text: { ...rest.text, text: `${rest.text.text}\n✅ Done (by <@${byUserId}>)` } };
    }
    return b;
  });
}
```

- [ ] **Step 4: Wire the action in `src/slack/app.ts`**

Add inside `createSlackApp` (imports: `completeCommitment`, `markBlocksDone` from `./complete.js`):
```ts
  app.action('mark_done', async ({ ack, body, action, client }) => {
    await ack();
    const id = Number((action as any).value);
    const r = await completeCommitment(db,
      (ch, sid) => client.chat.deleteScheduledMessage({ channel: ch, scheduled_message_id: sid }).then(() => {}), id);
    const b: any = body;
    if (!r.ok) {
      await client.chat.postEphemeral({ channel: b.channel.id, user: b.user.id, text: `⚠️ ${r.error}` });
      return;
    }
    if (b.message?.blocks) await client.chat.update({
      channel: b.channel.id, ts: b.message.ts, text: b.message.text ?? 'Updated',
      blocks: markBlocksDone(b.message.blocks, id, b.user.id) });
    await syncChannelCanvas(db, webCanvasClient(client), r.commitment!.channel_id);
  });
```

- [ ] **Step 5: Run tests, manual sandbox check**

Run: `npx vitest run` — Expected: all pass.
Manual: capture in `#proj-demo`, click **Mark done ✅** → button becomes "✅ Done (by @you)", canvas moves the item to Done.

- [ ] **Step 6: Commit**

```bash
git add src/slack/complete.ts src/slack/app.ts tests/slack/complete.test.ts
git commit -m "feat: mark-done completion with nudge cancellation and canvas resync"
```
