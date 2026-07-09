import type Database from 'better-sqlite3';
import type { Commitment, Decision } from '../store/types.js';
import { listLeavesOverlapping } from '../store/leaveStore.js';
import { addDays, localDay } from '../util/dates.js';
import { ownerLabel, userLabel } from './blocks.js';

export function canvasMarkdown(db: Database.Database, channelId: string, now: Date = new Date()): string {
  const decisions = db.prepare(`SELECT * FROM decisions WHERE channel_id = ? ORDER BY created_at DESC`)
    .all(channelId) as Decision[];
  const open = db.prepare(`SELECT * FROM commitments WHERE channel_id = ? AND status IN ('open','slipped')
    ORDER BY deadline IS NULL, deadline ASC`).all(channelId) as Commitment[];
  const done = db.prepare(`SELECT * FROM commitments WHERE channel_id = ? AND status = 'done'
    ORDER BY id DESC LIMIT 10`).all(channelId) as Commitment[];

  const dec = decisions.map(d => `- **${d.what}**${d.rationale ? ` — _${d.rationale}_` : ''} ([source](${d.source_permalink}))`);
  const op = open.map(c => `- ${c.status === 'slipped' ? '⚠️ overdue: ' : ''}${ownerLabel(c)} — ${c.task}${c.deadline ? ` (due ${c.deadline})` : ''}`);
  const dn = done.map(c => `- ✅ ${ownerLabel(c)} — ${c.task}`);
  const today = localDay(now);
  const owners = new Set(open.map(c => c.owner_user_id));
  const ooo = listLeavesOverlapping(db, today, addDays(today, 14))
    .filter(l => owners.has(l.user_id))
    .map(l => `- 🏖️ ${userLabel(l.user_id)} — out ${l.start_date} to ${l.end_date} (back ${addDays(l.end_date, 1)})`);
  return [
    '# 📒 FollowThrough Register', '',
    '## Decisions', ...(dec.length ? dec : ['_None yet._']), '',
    '## Open commitments', ...(op.length ? op : ['_None — all clear._']), '',
    ...(ooo.length ? ['## Out of office', ...ooo, ''] : []),
    '## Done', ...(dn.length ? dn : ['_None yet._']),
  ].join('\n');
}

export interface CanvasClient {
  create(channelId: string, md: string): Promise<string>;
  edit(canvasId: string, md: string): Promise<void>;
}

export function webCanvasClient(client: any): CanvasClient {
  return {
    async create(channelId, md) {
      const res = await client.conversations.canvases.create({
        channel_id: channelId, document_content: { type: 'markdown', markdown: md } });
      return res.canvas_id;
    },
    async edit(canvasId, md) {
      await client.canvases.edit({ canvas_id: canvasId,
        changes: [{ operation: 'replace', document_content: { type: 'markdown', markdown: md } }] });
    },
  };
}

export async function syncChannelCanvas(
  db: Database.Database, canvas: CanvasClient, channelId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const md = canvasMarkdown(db, channelId);
    const row = db.prepare(`SELECT canvas_id FROM channel_canvases WHERE channel_id = ?`).get(channelId) as
      { canvas_id: string } | undefined;
    if (row) await canvas.edit(row.canvas_id, md);
    else {
      const id = await canvas.create(channelId, md);
      db.prepare(`INSERT INTO channel_canvases (channel_id, canvas_id) VALUES (?, ?)`).run(channelId, id);
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
