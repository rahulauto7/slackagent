import type Database from 'better-sqlite3';
import type { Decision } from '../store/types.js';
import type { LlmClient } from '../llm/client.js';
import { searchDecisions } from '../store/decisionStore.js';

export function isBriefingAsk(text: string): boolean {
  return /what'?s my day|my day\?|\bbriefing\b|on (?:my|your) plate|what'?s due/i.test(text);
}

export function isRecallAsk(text: string): boolean {
  const t = text.trim().replace(/[‘’]/g, "'");
  if (!/[?？]$/.test(t)) return false;
  return /^(what|who|why|when|how|which|remind me|do (?:we|you) (?:know|remember))\b/i.test(t);
}

export function recallPrompt(question: string, decisions: Decision[], contextSnippets: string[]) {
  const system = `You answer questions about a team's recorded decisions.
Use ONLY the decision records and context provided. Cite each decision's permalink as <url|source>.
If the records don't answer the question, reply exactly: "I don't have a recorded decision about that."
Be concise (2-5 sentences).`;
  const records = decisions.map(d =>
    `- ${d.what} | why: ${d.rationale || 'n/a'} | by: ${d.decided_by || 'n/a'} | link: ${d.source_permalink}`).join('\n');
  const ctx = contextSnippets.length ? `\nSurrounding Slack context:\n${contextSnippets.join('\n')}` : '';
  return { system, user: `Question: ${question}\n\nDecision records:\n${records || '(none found)'}${ctx}` };
}

export async function answerRecall(
  db: Database.Database, llm: LlmClient, question: string,
  searchContext: (q: string) => Promise<string[]>,
): Promise<string> {
  const decisions = searchDecisions(db, question, 5);
  let snippets: string[] = [];
  try { snippets = await searchContext(question); }
  catch (e) { console.error('search.messages unavailable', e); }
  const { system, user } = recallPrompt(question, decisions, snippets);
  return llm.complete(system, user);
}
