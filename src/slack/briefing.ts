import type Database from 'better-sqlite3';
import type { Commitment, Decision } from '../store/types.js';
import type { LlmClient } from '../llm/client.js';
import { listOpenCommitments, flipSlipped, listOwnersWithOpen } from '../store/commitmentStore.js';
import { listDecisionsForChannelsSince } from '../store/decisionStore.js';
import { getLastBriefedAt, setLastBriefedAt } from '../store/userStore.js';
import { markDoneButton } from './blocks.js';

export type BriefingSections = { overdue: Commitment[]; dueToday: Commitment[]; dueThisWeek: Commitment[]; decisions: Decision[] };

export function buildBriefingSections(db: Database.Database, userId: string, now: Date): BriefingSections {
  const mine = listOpenCommitments(db, userId);
  const today = now.toISOString().slice(0, 10);
  const weekEnd = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const day = (c: Commitment) => c.deadline?.slice(0, 10) ?? '';
  const channels = [...new Set(mine.map(c => c.channel_id))];
  return {
    overdue: mine.filter(c => c.status === 'slipped'),
    dueToday: mine.filter(c => c.status === 'open' && day(c) === today),
    dueThisWeek: mine.filter(c => c.status === 'open' && day(c) > today && day(c) <= weekEnd),
    decisions: listDecisionsForChannelsSince(db, channels, getLastBriefedAt(db, userId)),
  };
}

export async function composeFocusLine(llm: LlmClient, s: BriefingSections): Promise<string> {
  try {
    const line = await llm.complete(
      'Write ONE short motivating sentence (max 2) summarizing this person\'s work day. Plain text only.',
      JSON.stringify({ overdue: s.overdue.map(c => c.task), dueToday: s.dueToday.map(c => c.task), dueThisWeek: s.dueThisWeek.map(c => c.task) }));
    return line.trim() || "Here's your day:";
  } catch (e) { console.error('focus line failed', e); return "Here's your day:"; }
}

const section = (title: string, rows: Commitment[]) => rows.map(c => ({
  type: 'section',
  text: { type: 'mrkdwn', text: `${title} *${c.task}*${c.deadline ? ` — due ${c.deadline}` : ''}` },
  accessory: markDoneButton(c.id),
}));

export function briefingBlocks(s: BriefingSections, focus: string): any[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `☀️ *Daily Briefing*\n${focus}` } },
    ...section('🔴 Overdue:', s.overdue),
    ...section('🟡 Due today:', s.dueToday),
    ...section('🗓️ This week:', s.dueThisWeek),
    ...s.decisions.map(d => ({ type: 'context', elements: [{ type: 'mrkdwn', text: `📌 Decided: ${d.what}` }] })),
  ];
}

export async function onDemandBriefing(
  db: Database.Database, llm: LlmClient, userId: string, now: Date,
): Promise<{ text: string; blocks?: any[] }> {
  const s = buildBriefingSections(db, userId, now);
  if (!s.overdue.length && !s.dueToday.length && !s.dueThisWeek.length)
    return { text: "You're clear — no open commitments. 🎉" };
  return { text: 'Your daily briefing', blocks: briefingBlocks(s, await composeFocusLine(llm, s)) };
}

export async function runDailyBriefings(
  db: Database.Database, llm: LlmClient,
  sendDm: (userId: string, text: string, blocks: any[]) => Promise<void>, now: Date,
): Promise<number> {
  flipSlipped(db, now.toISOString());
  let count = 0;
  for (const userId of listOwnersWithOpen(db)) {
    const s = buildBriefingSections(db, userId, now);
    await sendDm(userId, 'Your daily briefing', briefingBlocks(s, await composeFocusLine(llm, s)));
    setLastBriefedAt(db, userId, now.toISOString());
    count++;
  }
  return count;
}
