# Task 08: MCP server — read-only, three tools

Global constraints: see `00-overview.md`.

**Files:**
- Create: `src/mcp/tools.ts`, `src/mcp/server.ts`
- Modify: `package.json` (add `"express": "^4.21.0"`, `"@types/express": "^4.17.21"` dev)
- Test: `tests/mcp/tools.test.ts`

**Interfaces:**
- Consumes: `searchDecisions`, `getDecision` (Task 03), `listOpenCommitments` (Task 04).
- Produces (`tools.ts` — pure, JSON-string-returning handlers tested directly):
  - `toolSearchDecisions(db, query: string): string`
  - `toolListOpenCommitments(db, user?: string): string`
  - `toolGetDecision(db, id: number): string` — unknown id → `{"error":"decision <id> not found"}`
- Produces (`server.ts`): `startMcpServer(db: Database.Database, port: number): Promise<{ close(): void }>` — Streamable HTTP (stateless) at `POST /mcp`.

- [ ] **Step 1: Write the failing test**

`tests/mcp/tools.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { insertDecision } from '../../src/store/decisionStore.js';
import { insertCommitment } from '../../src/store/commitmentStore.js';
import { toolSearchDecisions, toolListOpenCommitments, toolGetDecision } from '../../src/mcp/tools.js';

let db: Database.Database;
beforeEach(() => {
  db = openDb(':memory:');
  insertDecision(db, { channel_id: 'C1', what: 'Use Stripe for billing', rationale: 'cheaper', decided_by: 'U1', source_permalink: 'https://x/p1' });
  insertCommitment(db, { channel_id: 'C1', owner_user_id: 'U2', task: 'wire test account', deadline: '2026-07-10', source_permalink: 'https://x/p2' });
});

describe('mcp tools', () => {
  it('search_decisions returns matches with permalinks', () => {
    const out = JSON.parse(toolSearchDecisions(db, 'stripe'));
    expect(out.results).toHaveLength(1);
    expect(out.results[0].source_permalink).toBe('https://x/p1');
  });
  it('list_open_commitments filters by user', () => {
    expect(JSON.parse(toolListOpenCommitments(db)).results).toHaveLength(1);
    expect(JSON.parse(toolListOpenCommitments(db, 'U9')).results).toHaveLength(0);
  });
  it('get_decision returns full record or error', () => {
    expect(JSON.parse(toolGetDecision(db, 1)).what).toBe('Use Stripe for billing');
    expect(JSON.parse(toolGetDecision(db, 999)).error).toMatch(/not found/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/tools.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/mcp/tools.ts`:
```ts
import type Database from 'better-sqlite3';
import { searchDecisions, getDecision } from '../store/decisionStore.js';
import { listOpenCommitments } from '../store/commitmentStore.js';

export function toolSearchDecisions(db: Database.Database, query: string): string {
  return JSON.stringify({ results: searchDecisions(db, query, 10) });
}

export function toolListOpenCommitments(db: Database.Database, user?: string): string {
  return JSON.stringify({ results: listOpenCommitments(db, user) });
}

export function toolGetDecision(db: Database.Database, id: number): string {
  const d = getDecision(db, id);
  return JSON.stringify(d ?? { error: `decision ${id} not found` });
}
```

`src/mcp/server.ts`:
```ts
import express from 'express';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { toolSearchDecisions, toolListOpenCommitments, toolGetDecision } from './tools.js';

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

export async function startMcpServer(db: Database.Database, port: number): Promise<{ close(): void }> {
  const app = express();
  app.use(express.json());
  app.post('/mcp', async (req, res) => {
    const server = new McpServer({ name: 'followthrough', version: '0.1.0' });
    server.tool('search_decisions', 'Full-text search over the org decision log',
      { query: z.string() }, async ({ query }) => text(toolSearchDecisions(db, query)));
    server.tool('list_open_commitments', 'Open commitments, optionally filtered by owner Slack user ID',
      { user: z.string().optional() }, async ({ user }) => text(toolListOpenCommitments(db, user)));
    server.tool('get_decision', 'Full decision record with rationale and source link',
      { id: z.number() }, async ({ id }) => text(toolGetDecision(db, id)));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const listener = app.listen(port);
  return { close: () => listener.close() };
}
```

- [ ] **Step 4: Run tests, verify server boots**

Run: `npx vitest run tests/mcp/tools.test.ts` — Expected: 3 passed.
Then: `npx tsx -e "import('./src/mcp/server.js').then(async m => { const { openDb } = await import('./src/store/db.js'); const s = await m.startMcpServer(openDb(':memory:'), 3920); console.log('mcp up'); s.close(); })"` — Expected: prints `mcp up`, exits cleanly.

- [ ] **Step 5: Commit**

```bash
git add src/mcp tests/mcp package.json package-lock.json
git commit -m "feat: read-only MCP server with three query tools"
```
