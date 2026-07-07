# Task 11: Bolt app + capture flow + entrypoint

Global constraints: see `00-overview.md`. Requires Task 09 tokens for the manual test; unit tests run offline.
Nudge scheduling on capture is wired in Task 14 — here `nudge_scheduled_id` stays NULL.

**Files:**
- Create: `src/slack/capture.ts`, `src/slack/app.ts`, `src/index.ts`
- Test: `tests/slack/capture.test.ts`

**Interfaces:**
- Consumes: `extract`/`ExtractionParseError` (06), stores (03/04), `resolveOwner` (10), `captureSummaryBlocks` (10).
- Produces (`capture.ts`):
  - `interface SlackReader { fetchThread(channelId: string, threadTs: string): Promise<{ userId: string; text: string }[]>; listMembers(): Promise<Member[]>; getPermalink(channelId: string, ts: string): Promise<string> }`
  - `captureThread(db, llm, reader: SlackReader, channelId: string, threadTs: string): Promise<{ text: string; blocks?: any[] }>` — full spec capture flow; on `ExtractionParseError` returns `{ text: "Sorry — I couldn't parse this thread..." }`; on empty extraction returns `{ text: 'Nothing captured — no decisions or commitments found in this thread.' }`
- Produces (`app.ts`): `createSlackApp(config, db, llm): App` — Bolt Socket Mode app; `app_mention` → `captureThread` → threaded reply. Includes `webClientReader(client, botUserId): SlackReader` adapter (uses `conversations.replies`, `users.list`, `chat.getPermalink`; thread text formatted `RealName: text`, bot's own messages excluded).
- Produces (`index.ts`): loads config, opens db, starts Bolt + MCP server (Task 08), logs "FollowThrough running".

- [ ] **Step 1: Write the failing test**

`tests/slack/capture.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { captureThread } from '../../src/slack/capture.js';
import { listOpenCommitments } from '../../src/store/commitmentStore.js';
import { FakeLlm } from '../helpers/fakeLlm.js';

const reader = {
  fetchThread: async () => [
    { userId: 'U1', text: 'we are going with stripe' },
    { userId: 'U2', text: "I'll wire the test account by friday" },
  ],
  listMembers: async () => [
    { id: 'U1', name: 'priya', realName: 'Priya N' },
    { id: 'U2', name: 'sam.j', realName: 'Sam Jones' },
  ],
  getPermalink: async () => 'https://x/perma',
};

let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });

describe('captureThread', () => {
  it('stores decisions/commitments with resolved owner and permalink', async () => {
    const llm = new FakeLlm([JSON.stringify({
      decisions: [{ what: 'Use Stripe', rationale: 'cheaper', decided_by: 'Priya N' }],
      commitments: [{ owner: 'Sam', task: 'wire test account', deadline: '2026-07-10' }],
    })]);
    const r = await captureThread(db, llm, reader, 'C1', '111.222');
    expect(r.blocks).toBeTruthy();
    const open = listOpenCommitments(db);
    expect(open[0].owner_user_id).toBe('U2');
    expect(open[0].source_permalink).toBe('https://x/perma');
  });
  it('reports empty result honestly and stores nothing', async () => {
    const llm = new FakeLlm([JSON.stringify({ decisions: [], commitments: [] })]);
    const r = await captureThread(db, llm, reader, 'C1', '111.222');
    expect(r.text).toMatch(/Nothing captured/);
    expect(listOpenCommitments(db)).toHaveLength(0);
  });
  it('refuses politely after double parse failure', async () => {
    const llm = new FakeLlm(['junk', 'junk']);
    const r = await captureThread(db, llm, reader, 'C1', '111.222');
    expect(r.text).toMatch(/couldn't parse/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/slack/capture.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/slack/capture.ts`**

```ts
import type Database from 'better-sqlite3';
import type { LlmClient } from '../llm/client.js';
import { extract, ExtractionParseError } from '../extractor/extract.js';
import { insertDecision } from '../store/decisionStore.js';
import { insertCommitment } from '../store/commitmentStore.js';
import { resolveOwner, type Member } from './ownerResolution.js';
import { captureSummaryBlocks } from './blocks.js';

export interface SlackReader {
  fetchThread(channelId: string, threadTs: string): Promise<{ userId: string; text: string }[]>;
  listMembers(): Promise<Member[]>;
  getPermalink(channelId: string, ts: string): Promise<string>;
}

export async function captureThread(
  db: Database.Database, llm: LlmClient, reader: SlackReader,
  channelId: string, threadTs: string,
): Promise<{ text: string; blocks?: any[] }> {
  const [msgs, members, permalink] = await Promise.all([
    reader.fetchThread(channelId, threadTs), reader.listMembers(),
    reader.getPermalink(channelId, threadTs),
  ]);
  const byId = new Map(members.map(m => [m.id, m]));
  const threadText = msgs.map(m => `${byId.get(m.userId)?.realName ?? m.userId}: ${m.text}`).join('\n');
  const participants = [...new Set(msgs.map(m => m.userId))]
    .map(id => byId.get(id)).filter((m): m is Member => !!m);

  let extraction;
  try { extraction = await extract(threadText, llm); }
  catch (e) {
    if (e instanceof ExtractionParseError)
      return { text: "Sorry — I couldn't parse this thread into decisions/commitments. Try rephrasing or a shorter excerpt." };
    throw e;
  }
  if (extraction.decisions.length === 0 && extraction.commitments.length === 0)
    return { text: 'Nothing captured — no decisions or commitments found in this thread.' };

  const decisions = extraction.decisions.map(d =>
    insertDecision(db, { channel_id: channelId, ...d, source_permalink: permalink }));
  const commitments = extraction.commitments.map(c =>
    insertCommitment(db, {
      channel_id: channelId, task: c.task, deadline: c.deadline, source_permalink: permalink,
      owner_user_id: resolveOwner(c.owner, participants, members),
    }));
  return { text: `Captured ${decisions.length} decision(s), ${commitments.length} commitment(s).`,
           blocks: captureSummaryBlocks(decisions, commitments) };
}
```

- [ ] **Step 4: Implement `src/slack/app.ts` and `src/index.ts`**

`src/slack/app.ts`:
```ts
import pkg from '@slack/bolt';
const { App } = pkg;
import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import type { LlmClient } from '../llm/client.js';
import { captureThread, type SlackReader } from './capture.js';

export function webClientReader(client: any, botUserId: string): SlackReader {
  return {
    async fetchThread(channelId, threadTs) {
      const res = await client.conversations.replies({ channel: channelId, ts: threadTs, limit: 200 });
      return (res.messages ?? [])
        .filter((m: any) => m.user && m.user !== botUserId && m.text)
        .map((m: any) => ({ userId: m.user, text: m.text.replace(new RegExp(`<@${botUserId}>`, 'g'), '').trim() }));
    },
    async listMembers() {
      const res = await client.users.list({ limit: 500 });
      return (res.members ?? []).filter((u: any) => !u.is_bot && !u.deleted)
        .map((u: any) => ({ id: u.id, name: u.name ?? '', realName: u.profile?.real_name ?? '' }));
    },
    async getPermalink(channelId, ts) {
      const res = await client.chat.getPermalink({ channel: channelId, message_ts: ts });
      return res.permalink ?? '';
    },
  };
}

export function createSlackApp(config: Config, db: Database.Database, llm: LlmClient) {
  const app = new App({ token: config.slackBotToken, appToken: config.slackAppToken, socketMode: true });
  app.event('app_mention', async ({ event, client, context }) => {
    const threadTs = (event as any).thread_ts ?? event.ts;
    try {
      const reader = webClientReader(client, context.botUserId!);
      const r = await captureThread(db, llm, reader, event.channel, threadTs);
      await client.chat.postMessage({ channel: event.channel, thread_ts: threadTs, text: r.text, blocks: r.blocks });
    } catch (e) {
      console.error('capture failed', e);
      await client.chat.postMessage({ channel: event.channel, thread_ts: threadTs,
        text: `⚠️ Capture failed: ${(e as Error).message}` });
    }
  });
  return app;
}
```

`src/index.ts`:
```ts
import { loadConfig } from './config.js';
import { openDb } from './store/db.js';
import { createLlmClient } from './llm/client.js';
import { createSlackApp } from './slack/app.js';
import { startMcpServer } from './mcp/server.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const llm = createLlmClient(config);
const app = createSlackApp(config, db, llm);
await app.start();
await startMcpServer(db, config.mcpPort);
console.log(`FollowThrough running — Slack connected, MCP on :${config.mcpPort}`);
```

- [ ] **Step 5: Run tests, then manual sandbox test**
Run: `npx vitest run` — Expected: all suites pass.
Manual (needs Task 09): `set -a && source .env && set +a && npm run dev`, then in `#proj-demo` post a decision-shaped thread and reply `@FollowThrough`. Expected: threaded summary card with a Mark done button.

- [ ] **Step 6: Commit**

```bash
git add src/slack src/index.ts tests/slack/capture.test.ts
git commit -m "feat: capture flow wired into Bolt app with entrypoint"
```
