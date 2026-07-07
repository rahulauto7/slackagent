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
