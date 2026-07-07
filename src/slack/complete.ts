import type Database from 'better-sqlite3';
import type { Commitment } from '../store/types.js';
import { getCommitment, markDone } from '../store/commitmentStore.js';

export async function completeCommitment(
  db: Database.Database,
  deleteScheduled: (channel: string, scheduledId: string) => Promise<void>,
  commitmentId: number,
): Promise<{ ok: boolean; commitment?: Commitment; error?: string }> {
  const existing = getCommitment(db, commitmentId);
  if (!existing) return { ok: false, error: `Commitment ${commitmentId} not found` };
  const done = markDone(db, commitmentId)!;
  if (existing.nudge_scheduled_id?.includes(':')) {
    const [channel, scheduledId] = existing.nudge_scheduled_id.split(':', 2);
    try { await deleteScheduled(channel, scheduledId); }
    catch { /* nudge already sent or expired — harmless per spec */ }
  }
  return { ok: true, commitment: done };
}

export function markBlocksDone(blocks: any[], commitmentId: number, byUserId: string): any[] {
  return blocks.map(b => {
    if (b.accessory?.action_id === 'mark_done' && b.accessory?.value === String(commitmentId)) {
      const { accessory, ...rest } = b;
      return { ...rest, text: { ...rest.text, text: `${rest.text.text}\n✅ Done (by <@${byUserId}>)` } };
    }
    return b;
  });
}
