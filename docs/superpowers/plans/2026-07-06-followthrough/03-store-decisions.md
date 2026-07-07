# Task 03: Store — decision queries + full-text search

Global constraints: see `00-overview.md`.

**Files:**
- Create: `src/store/decisionStore.ts`
- Test: `tests/store/decisionStore.test.ts`

**Interfaces:**
- Consumes: `openDb`, `Decision` (Task 02).
- Produces (all take `db: Database.Database` first):
  - `insertDecision(db, d: { channel_id: string; what: string; rationale: string; decided_by: string; source_permalink: string }): Decision`
  - `getDecision(db, id: number): Decision | undefined`
  - `searchDecisions(db, query: string, limit?: number): Decision[]` — never throws on user punctuation; empty query → `[]`
  - `listDecisionsForChannelsSince(db, channelIds: string[], sinceIso: string | null): Decision[]`

- [ ] **Step 1: Write the failing test**

`tests/store/decisionStore.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { insertDecision, getDecision, searchDecisions, listDecisionsForChannelsSince } from '../../src/store/decisionStore.js';

let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });

const d1 = { channel_id: 'C1', what: 'Use SQLite for storage', rationale: 'single file, zero ops', decided_by: 'U1', source_permalink: 'https://x/p1' };

describe('decisionStore', () => {
  it('inserts and gets by id', () => {
    const dec = insertDecision(db, d1);
    expect(dec.id).toBeGreaterThan(0);
    expect(getDecision(db, dec.id)?.what).toBe('Use SQLite for storage');
  });
  it('finds via FTS', () => {
    insertDecision(db, d1);
    expect(searchDecisions(db, 'sqlite')).toHaveLength(1);
    expect(searchDecisions(db, 'kubernetes')).toHaveLength(0);
  });
  it('does not throw on FTS operator characters in user input', () => {
    insertDecision(db, d1);
    expect(() => searchDecisions(db, 'what "about - pricing?')).not.toThrow();
    expect(searchDecisions(db, '   ')).toEqual([]);
  });
  it('filters by channel and since', () => {
    const a = insertDecision(db, d1);
    insertDecision(db, { ...d1, channel_id: 'C2' });
    expect(listDecisionsForChannelsSince(db, ['C1'], null).map(r => r.id)).toEqual([a.id]);
    expect(listDecisionsForChannelsSince(db, ['C1'], '2999-01-01T00:00:00Z')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store/decisionStore.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/store/decisionStore.ts`**

```ts
import type Database from 'better-sqlite3';
import type { Decision } from './types.js';

export function insertDecision(
  db: Database.Database,
  d: { channel_id: string; what: string; rationale: string; decided_by: string; source_permalink: string },
): Decision {
  const info = db.prepare(
    `INSERT INTO decisions (channel_id, what, rationale, decided_by, source_permalink)
     VALUES (@channel_id, @what, @rationale, @decided_by, @source_permalink)`,
  ).run(d);
  return getDecision(db, Number(info.lastInsertRowid))!;
}

export function getDecision(db: Database.Database, id: number): Decision | undefined {
  return db.prepare(`SELECT * FROM decisions WHERE id = ?`).get(id) as Decision | undefined;
}

/** Quote each term so user punctuation can't break FTS5 query syntax. */
function toFtsQuery(query: string): string {
  const terms = query.split(/\s+/).map(t => t.replace(/"/g, '')).filter(Boolean);
  return terms.map(t => `"${t}"`).join(' OR ');
}

export function searchDecisions(db: Database.Database, query: string, limit = 10): Decision[] {
  const fts = toFtsQuery(query);
  if (!fts) return [];
  return db.prepare(
    `SELECT d.* FROM decisions_fts f JOIN decisions d ON d.id = f.rowid
     WHERE decisions_fts MATCH ? ORDER BY rank LIMIT ?`,
  ).all(fts, limit) as Decision[];
}

export function listDecisionsForChannelsSince(
  db: Database.Database, channelIds: string[], sinceIso: string | null,
): Decision[] {
  if (channelIds.length === 0) return [];
  const placeholders = channelIds.map(() => '?').join(',');
  return db.prepare(
    `SELECT * FROM decisions WHERE channel_id IN (${placeholders})
     AND (? IS NULL OR created_at > ?) ORDER BY created_at DESC`,
  ).all(...channelIds, sinceIso, sinceIso) as Decision[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/store/decisionStore.test.ts` — Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/store/decisionStore.ts tests/store/decisionStore.test.ts
git commit -m "feat: decision store with FTS5 search"
```
