# Task 02: Store — schema + database open

Global constraints: see `00-overview.md`.

**Files:**
- Create: `src/store/db.ts`, `src/store/types.ts`
- Test: `tests/store/db.test.ts`

**Interfaces:**
- Produces: `openDb(path: string): Database.Database` — opens/creates SQLite file (`':memory:'` for tests), applies schema idempotently, enables WAL.
- Produces (`src/store/types.ts`): `CommitmentStatus`, `Decision`, `Commitment`, `isSlackUserId(owner: string): boolean`.

- [ ] **Step 1: Write the failing test**

`tests/store/db.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/store/db.js';

describe('openDb', () => {
  it('creates tables and FTS index', () => {
    const db = openDb(':memory:');
    const names = db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','trigger')`).all()
      .map((r: any) => r.name);
    expect(names).toContain('decisions');
    expect(names).toContain('commitments');
    expect(names).toContain('users');
    expect(names).toContain('decisions_fts');
  });
  it('rejects invalid commitment status via CHECK', () => {
    const db = openDb(':memory:');
    expect(() =>
      db.prepare(`INSERT INTO commitments (channel_id, owner_user_id, task, status) VALUES ('C1','U1','t','bogus')`).run()
    ).toThrow(/CHECK/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store/db.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/store/types.ts`:
```ts
export type CommitmentStatus = 'open' | 'done' | 'slipped';

export interface Decision {
  id: number; channel_id: string; what: string; rationale: string;
  decided_by: string; source_permalink: string; created_at: string;
}

export interface Commitment {
  id: number; channel_id: string; owner_user_id: string; task: string;
  deadline: string | null; status: CommitmentStatus;
  source_permalink: string; nudge_scheduled_id: string | null; created_at: string;
}

export function isSlackUserId(owner: string): boolean {
  return /^[UW][A-Z0-9]{2,}$/.test(owner);
}
```

`src/store/db.ts`:
```ts
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  what TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  decided_by TEXT NOT NULL DEFAULT '',
  source_permalink TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  task TEXT NOT NULL,
  deadline TEXT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','slipped')),
  source_permalink TEXT NOT NULL DEFAULT '',
  nudge_scheduled_id TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  last_briefed_at TEXT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
  what, rationale, content='decisions', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS decisions_ai AFTER INSERT ON decisions BEGIN
  INSERT INTO decisions_fts(rowid, what, rationale) VALUES (new.id, new.what, new.rationale);
END;
`;

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/store/db.test.ts` — Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/store tests/store
git commit -m "feat: SQLite schema with FTS5 index and status CHECK constraint"
```
