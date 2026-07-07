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
CREATE TABLE IF NOT EXISTS channel_canvases (
  channel_id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL
);
`;

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}
