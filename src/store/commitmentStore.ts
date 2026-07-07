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
