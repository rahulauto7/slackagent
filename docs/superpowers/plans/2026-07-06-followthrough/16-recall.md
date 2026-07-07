# Task 16: Recall — assistant thread with citations

Global constraints: see `00-overview.md`.
Spec: question in assistant thread → FTS over register + `search.messages` for context (best-effort; needs optional `SLACK_USER_TOKEN`) → LLM composes answer citing decisions and permalinks → suggested follow-up prompts. "what's my day?" is a suggested prompt routed to the on-demand briefing (Task 15).

**Files:**
- Create: `src/slack/recall.ts`
- Modify: `src/slack/app.ts` (register `Assistant`), `src/config.ts` (+ `slackUserToken: string` from `SLACK_USER_TOKEN`, default `''`)
- Test: `tests/slack/recall.test.ts`

**Interfaces:**
- Consumes: `searchDecisions` (03), `onDemandBriefing` (15), `LlmClient` (05).
- Produces (`recall.ts`):
  - `isBriefingAsk(text: string): boolean` — matches "what's my day", "my day?", "daily briefing" (case-insensitive)
  - `recallPrompt(question: string, decisions: Decision[], contextSnippets: string[]): { system: string; user: string }` — instructs: answer ONLY from the provided records, cite permalinks as `<url|source>`, say "I don't have a recorded decision about that" when records are empty/irrelevant
  - `answerRecall(db, llm, question: string, searchContext: (q: string) => Promise<string[]>): Promise<string>`

- [ ] **Step 1: Write the failing test**

`tests/slack/recall.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { insertDecision } from '../../src/store/decisionStore.js';
import { isBriefingAsk, recallPrompt, answerRecall } from '../../src/slack/recall.js';
import { FakeLlm } from '../helpers/fakeLlm.js';

let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });

describe('isBriefingAsk', () => {
  it('routes briefing phrasings, not recall questions', () => {
    expect(isBriefingAsk("What's my day?")).toBe(true);
    expect(isBriefingAsk('show my daily briefing')).toBe(true);
    expect(isBriefingAsk('what did we decide about pricing?')).toBe(false);
  });
});

describe('recallPrompt', () => {
  it('includes records, permalinks, and the honesty instruction', () => {
    insertDecision(db, { channel_id: 'C1', what: 'Price at $29', rationale: 'converts fine', decided_by: 'Priya', source_permalink: 'https://x/p9' });
    const { system, user } = recallPrompt('what about pricing?',
      [{ id: 1, channel_id: 'C1', what: 'Price at $29', rationale: 'converts fine', decided_by: 'Priya', source_permalink: 'https://x/p9', created_at: '' }], ['ctx line']);
    expect(system).toMatch(/don't have a recorded decision/i);
    expect(user).toContain('https://x/p9');
    expect(user).toContain('ctx line');
  });
});

describe('answerRecall', () => {
  it('feeds FTS matches to the LLM and returns its answer', async () => {
    insertDecision(db, { channel_id: 'C1', what: 'Price at $29', rationale: 'converts', decided_by: 'Priya', source_permalink: 'https://x/p9' });
    const llm = new FakeLlm(['We decided $29/mo (<https://x/p9|source>).']);
    const ans = await answerRecall(db, llm, 'what did we decide about the price?', async () => []);
    expect(ans).toContain('$29');
    expect(llm.calls[0].user).toContain('Price at $29');
  });
  it('search-context failures degrade gracefully', async () => {
    const llm = new FakeLlm(["I don't have a recorded decision about that."]);
    const ans = await answerRecall(db, llm, 'anything?', async () => { throw new Error('no token'); });
    expect(ans).toMatch(/don't have a recorded decision/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/slack/recall.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/slack/recall.ts`**

```ts
import type Database from 'better-sqlite3';
import type { Decision } from '../store/types.js';
import type { LlmClient } from '../llm/client.js';
import { searchDecisions } from '../store/decisionStore.js';

export function isBriefingAsk(text: string): boolean {
  return /what'?s my day|my day\?|daily briefing/i.test(text);
}

export function recallPrompt(question: string, decisions: Decision[], contextSnippets: string[]) {
  const system = `You answer questions about a team's recorded decisions.
Use ONLY the decision records and context provided. Cite each decision's permalink as <url|source>.
If the records don't answer the question, reply exactly: "I don't have a recorded decision about that."
Be concise (2-5 sentences).`;
  const records = decisions.map(d =>
    `- ${d.what} | why: ${d.rationale || 'n/a'} | by: ${d.decided_by || 'n/a'} | link: ${d.source_permalink}`).join('\n');
  const ctx = contextSnippets.length ? `\nSurrounding Slack context:\n${contextSnippets.join('\n')}` : '';
  return { system, user: `Question: ${question}\n\nDecision records:\n${records || '(none found)'}${ctx}` };
}

export async function answerRecall(
  db: Database.Database, llm: LlmClient, question: string,
  searchContext: (q: string) => Promise<string[]>,
): Promise<string> {
  const decisions = searchDecisions(db, question, 5);
  let snippets: string[] = [];
  try { snippets = await searchContext(question); }
  catch (e) { console.error('search.messages unavailable', e); }
  const { system, user } = recallPrompt(question, decisions, snippets);
  return llm.complete(system, user);
}
```

- [ ] **Step 4: Wire the `Assistant` in `src/slack/app.ts`**

```ts
import pkg from '@slack/bolt';
const { App, Assistant } = pkg;
import { isBriefingAsk, answerRecall } from './recall.js';
import { onDemandBriefing } from './briefing.js';
```
Inside `createSlackApp`, before `return app`:
```ts
  const assistant = new Assistant({
    threadStarted: async ({ say, setSuggestedPrompts }) => {
      await say('Hi! Ask me what was decided and why, or what\'s on your plate.');
      await setSuggestedPrompts({ prompts: [
        { title: "What's my day?", message: "What's my day?" },
        { title: 'Decision lookup', message: 'What did we decide about pricing and why?' },
      ] });
    },
    userMessage: async ({ message, say, setStatus, client }) => {
      const text = (message as any).text ?? '';
      const userId = (message as any).user;
      try {
        await setStatus('thinking...');
        if (isBriefingAsk(text)) {
          const r = await onDemandBriefing(db, llm, userId, new Date());
          await say({ text: r.text, blocks: r.blocks });
          return;
        }
        const searchContext = async (q: string): Promise<string[]> => {
          if (!config.slackUserToken) return [];
          const res = await client.search.messages({ token: config.slackUserToken, query: q, count: 5 });
          return (res.messages?.matches ?? []).map((m: any) => `${m.username}: ${m.text}`);
        };
        await say(await answerRecall(db, llm, text, searchContext));
      } catch (e) {
        console.error('assistant failed', e);
        await say(`⚠️ I couldn't answer that: ${(e as Error).message}`);
      }
    },
  });
  app.assistant(assistant);
```
`src/config.ts`: add `slackUserToken: env.SLACK_USER_TOKEN ?? ''` to the returned object and `slackUserToken: string` to `Config`.

- [ ] **Step 5: Run tests, manual sandbox check**

Run: `npx vitest run` — Expected: all pass.
Manual: open FollowThrough's assistant pane → suggested prompts appear; ask "what did we decide about X?" → cited answer; "What's my day?" → briefing or clear message.

- [ ] **Step 6: Commit**

```bash
git add src/slack/recall.ts src/slack/app.ts src/config.ts tests/slack/recall.test.ts
git commit -m "feat: assistant-thread recall with cited answers and briefing routing"
```
