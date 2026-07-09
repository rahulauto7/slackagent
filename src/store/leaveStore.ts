import type Database from 'better-sqlite3';
import type { Leave } from './types.js';

export function insertLeave(
  db: Database.Database,
  l: { user_id: string; start_date: string; end_date: string; channel_id: string },
): Leave {
  const info = db.prepare(
    `INSERT INTO leaves (user_id, start_date, end_date, channel_id)
     VALUES (@user_id, @start_date, @end_date, @channel_id)`,
  ).run(l);
  return db.prepare(`SELECT * FROM leaves WHERE id = ?`).get(Number(info.lastInsertRowid)) as Leave;
}

export function cancelActiveLeaves(db: Database.Database, userId: string): number {
  return db.prepare(`UPDATE leaves SET status='cancelled' WHERE user_id = ? AND status='active'`)
    .run(userId).changes;
}

export function getLeaveCovering(db: Database.Database, userId: string, dateIso: string): Leave | undefined {
  return db.prepare(
    `SELECT * FROM leaves WHERE user_id = ? AND status='active' AND start_date <= ? AND end_date >= ?
     ORDER BY start_date LIMIT 1`,
  ).get(userId, dateIso, dateIso) as Leave | undefined;
}

export function listLeavesOverlapping(db: Database.Database, startIso: string, endIso: string): Leave[] {
  return db.prepare(
    `SELECT * FROM leaves WHERE status='active' AND start_date <= ? AND end_date >= ?
     ORDER BY start_date ASC, id ASC`,
  ).all(endIso, startIso) as Leave[];
}
