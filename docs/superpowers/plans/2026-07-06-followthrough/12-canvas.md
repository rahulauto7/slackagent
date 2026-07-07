# Task 12: Per-channel canvas register

Global constraints: see `00-overview.md`.
Store stays source of truth: canvas failure never fails a capture (spec Error handling).

**Files:**
- Create: `src/slack/canvas.ts`
- Modify: `src/store/db.ts` (append to `SCHEMA`), `src/slack/app.ts` (call sync after capture)
- Test: `tests/slack/canvas.test.ts`

**Interfaces:**
- Consumes: `listOpenCommitments` + done rows (04), decisions (03), `ownerLabel` (10).
- Produces (`canvas.ts`):
  - `canvasMarkdown(db, channelId: string): string` — register content: `# 📒 FollowThrough Register`, `## Decisions` (what, why, permalink), `## Open commitments` (owner, task, deadline; slipped rows prefixed `⚠️ overdue`), `## Done` (last 10)
  - `interface CanvasClient { create(channelId: string, md: string): Promise<string>; edit(canvasId: string, md: string): Promise<void> }`
  - `syncChannelCanvas(db, canvas: CanvasClient, channelId: string): Promise<{ ok: boolean; error?: string }>` — never throws
  - `webCanvasClient(client: any): CanvasClient` — `conversations.canvases.create` / `canvases.edit` (replace op)
- Schema addition: `CREATE TABLE IF NOT EXISTS channel_canvases (channel_id TEXT PRIMARY KEY, canvas_id TEXT NOT NULL);` (plumbing table; spec data model unchanged otherwise)

- [ ] **Step 1: Write the failing test**

`tests/slack/canvas.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { insertDecision } from '../../src/store/decisionStore.js';
import { insertCommitment, markDone } from '../../src/store/commitmentStore.js';
import { canvasMarkdown, syncChannelCanvas } from '../../src/slack/canvas.js';

let db: Database.Database;
beforeEach(() => {
  db = openDb(':memory:');
  insertDecision(db, { channel_id: 'C1', what: 'Use Stripe', rationale: 'cheaper', decided_by: 'U1', source_permalink: 'https://x/p' });
  insertCommitment(db, { channel_id: 'C1', owner_user_id: 'U2', task: 'wire account', deadline: '2026-07-10', source_permalink: 'https://x/p' });
});

describe('canvasMarkdown', () => {
  it('renders decisions, open and done sections scoped to the channel', () => {
    const done = insertCommitment(db, { channel_id: 'C1', owner_user_id: 'U2', task: 'old task', deadline: null, source_permalink: 'https://x/p' });
    markDone(db, done.id);
    insertDecision(db, { channel_id: 'C2', what: 'Other channel', rationale: '', decided_by: '', source_permalink: '' });
    const md = canvasMarkdown(db, 'C1');
    expect(md).toContain('Use Stripe');
    expect(md).toContain('wire account');
    expect(md).toContain('old task');
    expect(md).not.toContain('Other channel');
  });
});

describe('syncChannelCanvas', () => {
  it('creates once then edits, and never throws on API failure', async () => {
    const calls: string[] = [];
    const canvas = {
      create: async () => { calls.push('create'); return 'F1'; },
      edit: async () => { calls.push('edit'); },
    };
    expect((await syncChannelCanvas(db, canvas, 'C1')).ok).toBe(true);
    expect((await syncChannelCanvas(db, canvas, 'C1')).ok).toBe(true);
    expect(calls).toEqual(['create', 'edit']);
    const broken = { create: async () => { throw new Error('boom'); }, edit: async () => {} };
    const r = await syncChannelCanvas(db, broken, 'C2');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/boom/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/slack/canvas.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Append to `SCHEMA` in `src/store/db.ts` (before the closing backtick):
```sql
CREATE TABLE IF NOT EXISTS channel_canvases (
  channel_id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL
);
```

`src/slack/canvas.ts`:
```ts
import type Database from 'better-sqlite3';
import type { Commitment, Decision } from '../store/types.js';
import { ownerLabel } from './blocks.js';

export function canvasMarkdown(db: Database.Database, channelId: string): string {
  const decisions = db.prepare(`SELECT * FROM decisions WHERE channel_id = ? ORDER BY created_at DESC`)
    .all(channelId) as Decision[];
  const open = db.prepare(`SELECT * FROM commitments WHERE channel_id = ? AND status IN ('open','slipped')
    ORDER BY deadline IS NULL, deadline ASC`).all(channelId) as Commitment[];
  const done = db.prepare(`SELECT * FROM commitments WHERE channel_id = ? AND status = 'done'
    ORDER BY id DESC LIMIT 10`).all(channelId) as Commitment[];

  const dec = decisions.map(d => `- **${d.what}**${d.rationale ? ` — _${d.rationale}_` : ''} ([source](${d.source_permalink}))`);
  const op = open.map(c => `- ${c.status === 'slipped' ? '⚠️ overdue: ' : ''}${ownerLabel(c)} — ${c.task}${c.deadline ? ` (due ${c.deadline})` : ''}`);
  const dn = done.map(c => `- ✅ ${ownerLabel(c)} — ${c.task}`);
  return [
    '# 📒 FollowThrough Register', '',
    '## Decisions', ...(dec.length ? dec : ['_None yet._']), '',
    '## Open commitments', ...(op.length ? op : ['_None — all clear._']), '',
    '## Done', ...(dn.length ? dn : ['_None yet._']),
  ].join('\n');
}

export interface CanvasClient {
  create(channelId: string, md: string): Promise<string>;
  edit(canvasId: string, md: string): Promise<void>;
}

export function webCanvasClient(client: any): CanvasClient {
  return {
    async create(channelId, md) {
      const res = await client.conversations.canvases.create({
        channel_id: channelId, document_content: { type: 'markdown', markdown: md } });
      return res.canvas_id;
    },
    async edit(canvasId, md) {
      await client.canvases.edit({ canvas_id: canvasId,
        changes: [{ operation: 'replace', document_content: { type: 'markdown', markdown: md } }] });
    },
  };
}

export async function syncChannelCanvas(
  db: Database.Database, canvas: CanvasClient, channelId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const md = canvasMarkdown(db, channelId);
    const row = db.prepare(`SELECT canvas_id FROM channel_canvases WHERE channel_id = ?`).get(channelId) as
      { canvas_id: string } | undefined;
    if (row) await canvas.edit(row.canvas_id, md);
    else {
      const id = await canvas.create(channelId, md);
      db.prepare(`INSERT INTO channel_canvases (channel_id, canvas_id) VALUES (?, ?)`).run(channelId, id);
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
```

In `src/slack/app.ts` `app_mention` handler, after `postMessage` of the capture result, add:
```ts
      const sync = await syncChannelCanvas(db, webCanvasClient(client), event.channel);
      if (!sync.ok) await client.chat.postMessage({ channel: event.channel, thread_ts: threadTs,
        text: `⚠️ Captured, but the canvas register couldn't be updated: ${sync.error}` });
```
(with `import { syncChannelCanvas, webCanvasClient } from './canvas.js';` at top; only run when `r.blocks` is set).

- [ ] **Step 4: Run tests, then manual sandbox check**

Run: `npx vitest run` — Expected: all pass.
Manual: re-run a capture in `#proj-demo`; channel canvas appears/updates with the register.

- [ ] **Step 5: Commit**

```bash
git add src/slack/canvas.ts src/slack/app.ts src/store/db.ts tests/slack/canvas.test.ts
git commit -m "feat: per-channel canvas register synced on capture"
```
