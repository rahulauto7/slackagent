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
