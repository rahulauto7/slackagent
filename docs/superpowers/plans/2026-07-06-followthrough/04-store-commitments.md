# Task 04: Store — commitment + user queries

Global constraints: see `00-overview.md`.

**Files:**
- Create: `src/store/commitmentStore.ts`, `src/store/userStore.ts`
- Test: `tests/store/commitmentStore.test.ts`

**Interfaces:**
- Consumes: Task 02 types.
- Produces (`commitmentStore.ts`, all take `db` first):
  - `insertCommitment(db, c: { channel_id: string; owner_user_id: string; task: string; deadline: string | null; source_permalink: string }): Commitment`
  - `getCommitment(db, id: number): Commitment | undefined`
  - `listOpenCommitments(db, ownerUserId?: string): Commitment[]` — status IN ('open','slipped'), earliest deadline first, NULL deadlines last
  - `markDone(db, id: number): Commitment | undefined` — works from `open` **and** `slipped`
  - `setNudgeScheduledId(db, id: number, scheduledId: string | null): void`
  - `flipSlipped(db, nowIso: string): number` — `open`→`slipped` where deadline past (date-only compares against `nowIso.slice(0,10)`); returns count
  - `listOwnersWithOpen(db): string[]` — distinct owners with open/slipped, resolved Slack IDs only
- Produces (`userStore.ts`): `getLastBriefedAt(db, userId): string | null`, `setLastBriefedAt(db, userId, iso): void` (upsert)

- [ ] **Step 1: Write the failing test**

`tests/store/commitmentStore.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/store/db.js';
import { insertCommitment, getCommitment, listOpenCommitments, markDone, setNudgeScheduledId, flipSlipped, listOwnersWithOpen } from '../../src/store/commitmentStore.js';
import { getLastBriefedAt, setLastBriefedAt } from '../../src/store/userStore.js';

let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });
const base = { channel_id: 'C1', owner_user_id: 'U1', task: 'send deck', source_permalink: 'https://x/p1' };

describe('commitmentStore', () => {
  it('inserts and lists by owner', () => {
    insertCommitment(db, { ...base, deadline: '2026-07-10' });
    insertCommitment(db, { ...base, owner_user_id: 'U2', deadline: null });
    expect(listOpenCommitments(db, 'U1')).toHaveLength(1);
    expect(listOpenCommitments(db)).toHaveLength(2);
  });
  it('markDone works from open and slipped', () => {
    const a = insertCommitment(db, { ...base, deadline: '2020-01-01' });
    flipSlipped(db, '2026-07-06T09:00:00Z');
    expect(getCommitment(db, a.id)?.status).toBe('slipped');
    expect(markDone(db, a.id)?.status).toBe('done');
  });
  it('flipSlipped only touches past-deadline open rows', () => {
    insertCommitment(db, { ...base, deadline: '2020-01-01' });
    insertCommitment(db, { ...base, deadline: '2999-01-01' });
    insertCommitment(db, { ...base, deadline: null });
    expect(flipSlipped(db, '2026-07-06T09:00:00Z')).toBe(1);
  });
  it('stores nudge id', () => {
    const a = insertCommitment(db, { ...base, deadline: '2026-07-10' });
    setNudgeScheduledId(db, a.id, 'Q123');
    expect(getCommitment(db, a.id)?.nudge_scheduled_id).toBe('Q123');
  });
  it('listOwnersWithOpen skips raw-name owners', () => {
    insertCommitment(db, { ...base, deadline: null });
    insertCommitment(db, { ...base, owner_user_id: 'sarah from infra', deadline: null });
    expect(listOwnersWithOpen(db)).toEqual(['U1']);
  });
});

describe('userStore', () => {
  it('upserts last_briefed_at', () => {
    expect(getLastBriefedAt(db, 'U1')).toBeNull();
    setLastBriefedAt(db, 'U1', '2026-07-06T09:00:00Z');
    setLastBriefedAt(db, 'U1', '2026-07-07T09:00:00Z');
    expect(getLastBriefedAt(db, 'U1')).toBe('2026-07-07T09:00:00Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store/commitmentStore.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/store/commitmentStore.ts`:
```ts
import type Database from 'better-sqlite3';
import { type Commitment, isSlackUserId } from './types.js';

export function insertCommitment(
  db: Database.Database,
  c: { channel_id: string; owner_user_id: string; task: string; deadline: string | null; source_permalink: string },
): Commitment {
  const info = db.prepare(
    `INSERT INTO commitments (channel_id, owner_user_id, task, deadline, source_permalink)
     VALUES (@channel_id, @owner_user_id, @task, @deadline, @source_permalink)`,
  ).run(c);
  return getCommitment(db, Number(info.lastInsertRowid))!;
}

export function getCommitment(db: Database.Database, id: number): Commitment | undefined {
  return db.prepare(`SELECT * FROM commitments WHERE id = ?`).get(id) as Commitment | undefined;
}

export function listOpenCommitments(db: Database.Database, ownerUserId?: string): Commitment[] {
  const where = ownerUserId ? `AND owner_user_id = ?` : '';
  const args = ownerUserId ? [ownerUserId] : [];
  return db.prepare(
    `SELECT * FROM commitments WHERE status IN ('open','slipped') ${where}
     ORDER BY deadline IS NULL, deadline ASC, id ASC`,
  ).all(...args) as Commitment[];
}

export function markDone(db: Database.Database, id: number): Commitment | undefined {
  db.prepare(`UPDATE commitments SET status='done' WHERE id = ? AND status IN ('open','slipped')`).run(id);
  return getCommitment(db, id);
}

export function setNudgeScheduledId(db: Database.Database, id: number, scheduledId: string | null): void {
  db.prepare(`UPDATE commitments SET nudge_scheduled_id = ? WHERE id = ?`).run(scheduledId, id);
}

export function flipSlipped(db: Database.Database, nowIso: string): number {
  const today = nowIso.slice(0, 10);
  return db.prepare(
    `UPDATE commitments SET status='slipped'
     WHERE status='open' AND deadline IS NOT NULL
       AND (CASE WHEN length(deadline) = 10 THEN deadline < ? ELSE deadline < ? END)`,
  ).run(today, nowIso).changes;
}

export function listOwnersWithOpen(db: Database.Database): string[] {
  const rows = db.prepare(
    `SELECT DISTINCT owner_user_id FROM commitments WHERE status IN ('open','slipped')`,
  ).all() as { owner_user_id: string }[];
  return rows.map(r => r.owner_user_id).filter(isSlackUserId);
}
```

`src/store/userStore.ts`:
```ts
import type Database from 'better-sqlite3';

export function getLastBriefedAt(db: Database.Database, userId: string): string | null {
  const row = db.prepare(`SELECT last_briefed_at FROM users WHERE user_id = ?`).get(userId) as
    { last_briefed_at: string | null } | undefined;
  return row?.last_briefed_at ?? null;
}

export function setLastBriefedAt(db: Database.Database, userId: string, iso: string): void {
  db.prepare(
    `INSERT INTO users (user_id, last_briefed_at) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET last_briefed_at = excluded.last_briefed_at`,
  ).run(userId, iso);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/store/commitmentStore.test.ts` — Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/store/commitmentStore.ts src/store/userStore.ts tests/store/commitmentStore.test.ts
git commit -m "feat: commitment and user stores with slipped-flip logic"
```
