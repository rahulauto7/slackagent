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
