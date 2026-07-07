import type Database from 'better-sqlite3';
import { type Commitment, isSlackUserId } from '../store/types.js';
import { setNudgeScheduledId } from '../store/commitmentStore.js';
import { nudgeBlocks, ownerLabel } from './blocks.js';

export function computeNudgePostAt(deadline: string, now: Date): number | null {
  const at = deadline.length === 10
    ? new Date(`${deadline}T09:00:00`).getTime()
    : new Date(deadline).getTime() - 24 * 3600 * 1000;
  return at > now.getTime() ? Math.floor(at / 1000) : null;
}

export interface NudgeSender {
  openDm(userId: string): Promise<string>;
  schedule(channel: string, postAt: number, text: string, blocks: any[]): Promise<string>;
}

export function webNudgeSender(client: any): NudgeSender {
  return {
    openDm: async (u) => (await client.conversations.open({ users: u })).channel.id,
    schedule: async (channel, post_at, text, blocks) =>
      (await client.chat.scheduleMessage({ channel, post_at, text, blocks })).scheduled_message_id,
  };
}

export async function scheduleNudge(
  db: Database.Database, sender: NudgeSender, c: Commitment, now: Date = new Date(),
): Promise<boolean> {
  if (!c.deadline || !isSlackUserId(c.owner_user_id)) return false;
  const postAt = computeNudgePostAt(c.deadline, now);
  if (postAt === null) return false;
  const dm = await sender.openDm(c.owner_user_id);
  const id = await sender.schedule(dm, postAt, `Reminder: ${c.task} is due ${c.deadline}`, nudgeBlocks(c));
  setNudgeScheduledId(db, c.id, `${dm}:${id}`);
  return true;
}

export function buildWeeklyDigest(db: Database.Database, channelId: string, now: Date): string | null {
  const rows = db.prepare(`SELECT * FROM commitments WHERE channel_id = ? AND status IN ('open','slipped')`)
    .all(channelId) as Commitment[];
  if (rows.length === 0) return null;
  const weekEnd = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const line = (c: Commitment) => `• ${ownerLabel(c)} — ${c.task}${c.deadline ? ` (due ${c.deadline})` : ''}`;
  const overdue = rows.filter(c => c.status === 'slipped').map(line);
  const dueSoon = rows.filter(c => c.status === 'open' && c.deadline && c.deadline.slice(0, 10) >= today && c.deadline.slice(0, 10) <= weekEnd).map(line);
  const noDeadline = rows.filter(c => !c.deadline).map(line);
  const parts = ['*📋 Weekly FollowThrough digest*'];
  if (overdue.length) parts.push(`*Overdue:*\n${overdue.join('\n')}`);
  if (dueSoon.length) parts.push(`*Due this week:*\n${dueSoon.join('\n')}`);
  if (noDeadline.length) parts.push(`*No deadline set (needs one?):*\n${noDeadline.join('\n')}`);
  return parts.join('\n\n');
}
