import type Database from 'better-sqlite3';
import type { Commitment } from '../store/types.js';
import type { LlmClient } from '../llm/client.js';
import { listOpenCommitments, setNudgeScheduledId } from '../store/commitmentStore.js';
import { insertLeave, cancelActiveLeaves, listLeavesOverlapping } from '../store/leaveStore.js';
import { looksLikeLeave, parseLeaveIntent } from '../extractor/leave.js';
import { addDays, localDay } from '../util/dates.js';
import { computeNudgePostAt, type NudgeSender } from './nudger.js';
import { nudgeBlocks } from './blocks.js';

export interface LeaveMessenger {
  deleteScheduled(channel: string, scheduledId: string): Promise<void>;
  post(channel: string, text: string): Promise<void>;
}

function dueDuringLeave(c: Commitment, start: string, end: string, now: Date): boolean {
  if (!c.deadline) return false;
  const day = c.deadline.slice(0, 10);
  if (day >= start && day <= end) return true;
  const postAt = computeNudgePostAt(c.deadline, now);
  if (postAt === null) return false;
  const nudgeDay = localDay(new Date(postAt * 1000));
  return nudgeDay >= start && nudgeDay <= end;
}

async function deleteExistingNudge(messenger: LeaveMessenger, c: Commitment): Promise<boolean> {
  if (!c.nudge_scheduled_id?.includes(':')) return false;
  const [channel, scheduledId] = c.nudge_scheduled_id.split(':', 2);
  try { await messenger.deleteScheduled(channel, scheduledId); }
  catch { /* nudge already sent or expired — harmless per spec */ }
  return true;
}

export async function declareLeave(
  db: Database.Database, sender: NudgeSender, messenger: LeaveMessenger,
  args: { userId: string; startDate: string; endDate: string; channelId: string },
  now: Date = new Date(),
): Promise<{ text: string; channels: string[] }> {
  cancelActiveLeaves(db, args.userId);
  insertLeave(db, {
    user_id: args.userId, start_date: args.startDate, end_date: args.endDate, channel_id: args.channelId,
  });
  const mine = listOpenCommitments(db, args.userId);
  const returnDay = addDays(args.endDate, 1);
  const returnAt = Math.floor(new Date(`${returnDay}T09:00:00`).getTime() / 1000);

  let moved = 0;
  const atRisk = new Map<string, Commitment[]>();
  for (const c of mine) {
    if (!dueDuringLeave(c, args.startDate, args.endDate, now)) continue;
    atRisk.set(c.channel_id, [...(atRisk.get(c.channel_id) ?? []), c]);
    if (!(await deleteExistingNudge(messenger, c))) continue;
    if (returnAt <= Math.floor(now.getTime() / 1000)) { setNudgeScheduledId(db, c.id, null); continue; }
    const dm = await sender.openDm(args.userId);
    const id = await sender.schedule(dm, returnAt, `Reminder (you were away): ${c.task} was due ${c.deadline}`, nudgeBlocks(c));
    setNudgeScheduledId(db, c.id, `${dm}:${id}`);
    moved++;
  }

  for (const [channel, cs] of atRisk) {
    const lines = cs.map(c => `• ${c.task} (due ${c.deadline})`).join('\n');
    await messenger.post(channel,
      `⚠️ <@${args.userId}> is out ${args.startDate} to ${args.endDate}. Due while away:\n${lines}\nAnyone covering? Mention me in a thread to capture a new owner.`);
  }

  const flagged = [...atRisk.values()].reduce((n, cs) => n + cs.length, 0);
  const parts = [`🏖️ Got it — you're on leave ${args.startDate} to ${args.endDate}.`];
  if (moved) parts.push(`Moved ${moved} reminder(s) to ${returnDay} 09:00.`);
  if (flagged) parts.push(`Flagged ${flagged} commitment(s) due while you're away so the team can cover.`);
  if (!moved && !flagged) parts.push('Nothing is due while you\'re away. Enjoy!');
  return { text: parts.join(' '), channels: [...new Set(mine.map(c => c.channel_id))] };
}

export async function cancelLeave(
  db: Database.Database, sender: NudgeSender, messenger: LeaveMessenger,
  userId: string, now: Date = new Date(),
): Promise<{ text: string; channels: string[] }> {
  if (cancelActiveLeaves(db, userId) === 0)
    return { text: 'You have no active leave to cancel.', channels: [] };
  const mine = listOpenCommitments(db, userId);
  for (const c of mine) {
    if (!c.deadline || !(await deleteExistingNudge(messenger, c))) continue;
    const postAt = computeNudgePostAt(c.deadline, now);
    if (postAt === null) { setNudgeScheduledId(db, c.id, null); continue; }
    const dm = await sender.openDm(userId);
    const id = await sender.schedule(dm, postAt, `Reminder: ${c.task} is due ${c.deadline}`, nudgeBlocks(c));
    setNudgeScheduledId(db, c.id, `${dm}:${id}`);
  }
  return { text: '🏖️ Welcome back! Your leave is cancelled and reminders are back to normal.',
           channels: [...new Set(mine.map(c => c.channel_id))] };
}

export async function handleLeaveMessage(
  db: Database.Database, llm: LlmClient, sender: NudgeSender, messenger: LeaveMessenger,
  msg: { text: string; userId: string; channelId: string },
  now: Date = new Date(),
): Promise<{ text: string; channels: string[] } | null> {
  if (!looksLikeLeave(msg.text)) return null;
  const intent = await parseLeaveIntent(msg.text, llm, now);
  switch (intent.intent) {
    case 'declare':
      if (!intent.start_date) return {
        text: "🏖️ Happy to log your leave — I just couldn't figure out the dates. Try \"I'm on leave July 10-14\".",
        channels: [] };
      return declareLeave(db, sender, messenger, {
        userId: msg.userId, startDate: intent.start_date,
        endDate: intent.end_date ?? intent.start_date, channelId: msg.channelId }, now);
    case 'cancel': return cancelLeave(db, sender, messenger, msg.userId, now);
    case 'query': return { text: whosOut(db, now), channels: [] };
    case 'none': return null;
  }
}

export function whosOut(db: Database.Database, now: Date = new Date()): string {
  const today = localDay(now);
  const leaves = listLeavesOverlapping(db, today, addDays(today, 7));
  if (leaves.length === 0) return 'No one is out in the next 7 days. 🎉';
  const lines = leaves.map(l => {
    const due = listOpenCommitments(db, l.user_id)
      .filter(c => c.deadline && c.deadline.slice(0, 10) >= l.start_date && c.deadline.slice(0, 10) <= l.end_date)
      .map(c => `\n    ↳ ${c.task} (due ${c.deadline})`).join('');
    return `🏖️ <@${l.user_id}> — out ${l.start_date} to ${l.end_date} (back ${addDays(l.end_date, 1)})${due}`;
  });
  return `*Out in the next 7 days:*\n${lines.join('\n')}`;
}
