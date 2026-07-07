import { type Commitment, type Decision, isSlackUserId } from '../store/types.js';

export function ownerLabel(c: Commitment): string {
  return isSlackUserId(c.owner_user_id) ? `<@${c.owner_user_id}>` : c.owner_user_id;
}

export function markDoneButton(id: number) {
  return { type: 'button', action_id: 'mark_done', value: String(id),
           text: { type: 'plain_text', text: 'Mark done ✅' } };
}

const mrkdwn = (text: string) => ({ type: 'section', text: { type: 'mrkdwn', text } });

export function captureSummaryBlocks(decisions: Decision[], commitments: Commitment[]): any[] {
  const blocks: any[] = [mrkdwn(`*Captured* — ${decisions.length} decision(s), ${commitments.length} commitment(s)`)];
  for (const d of decisions)
    blocks.push(mrkdwn(`📌 *${d.what}*${d.rationale ? `\n_Why:_ ${d.rationale}` : ''}`));
  for (const c of commitments)
    blocks.push({ ...mrkdwn(`☑️ ${ownerLabel(c)}: ${c.task}${c.deadline ? ` — due ${c.deadline}` : ' — no deadline'}`),
                  accessory: markDoneButton(c.id) });
  return blocks;
}

export function nudgeBlocks(c: Commitment): any[] {
  return [
    { ...mrkdwn(`⏰ Reminder: *${c.task}* is due ${c.deadline}.\n<${c.source_permalink}|Where you committed>`),
      accessory: markDoneButton(c.id) },
  ];
}
