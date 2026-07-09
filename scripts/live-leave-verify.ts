// Live end-to-end check of the leave flows against the real Slack API + LLM.
// Exercises exactly what the app_mention handler runs after the gate; posts one
// at-risk flag to the test channel and cleans up after itself.
import { WebClient } from '@slack/web-api';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/store/db.js';
import { createLlmClient } from '../src/llm/client.js';
import { insertCommitment, getCommitment } from '../src/store/commitmentStore.js';
import { scheduleNudge, webNudgeSender } from '../src/slack/nudger.js';
import { handleLeaveMessage, whosOut } from '../src/slack/leave.js';
import { webLeaveMessenger } from '../src/slack/app.js';
import { syncChannelCanvas, webCanvasClient } from '../src/slack/canvas.js';
import { addDays, localDay } from '../src/util/dates.js';

const CHANNEL = process.env.LIVE_CHANNEL ?? 'C0BGEFQRY80'; // #proj-demo
const USER = process.env.LIVE_USER ?? 'U0BF47PHSCF';        // rahulbhai

const config = loadConfig();
const db = openDb(config.dbPath);
const llm = createLlmClient(config);
const client = new WebClient(config.slackBotToken);
const sender = webNudgeSender(client);
const messenger = webLeaveMessenger(client);
const now = new Date();
const start = addDays(localDay(now), 1);
const end = addDays(localDay(now), 3);

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const scheduledFor = async (dm: string) => {
  const r = await client.chat.scheduledMessages.list({ channel: dm });
  return (r.scheduled_messages ?? []).map(m => m.post_at as number);
};

// 1. Seed a commitment due during the upcoming leave, with a real scheduled nudge.
const c = insertCommitment(db, {
  channel_id: CHANNEL, owner_user_id: USER, task: '[live-verify] prepare launch checklist',
  deadline: addDays(localDay(now), 2), source_permalink: '',
});
check('nudge scheduled for seeded commitment', await scheduleNudge(db, sender, c, now));
const dm = getCommitment(db, c.id)!.nudge_scheduled_id!.split(':', 2)[0];
const before = await scheduledFor(dm);

// 2. Declare leave in natural language through the real router.
const declare = await handleLeaveMessage(db, llm, sender, messenger,
  { text: `I'm on leave ${start} to ${end}`, userId: USER, channelId: CHANNEL }, now);
check('declaration recognized and confirmed', !!declare && declare.text.includes(start), declare?.text);

// 3. The nudge moved to the return morning.
const after = await scheduledFor(dm);
const returnAt = Math.floor(new Date(`${addDays(end, 1)}T09:00:00`).getTime() / 1000);
check('scheduled nudge moved to return morning', after.includes(returnAt),
  `before=${JSON.stringify(before)} after=${JSON.stringify(after)} want=${returnAt}`);

// 4. At-risk flag posted in the channel.
const hist = await client.conversations.history({ channel: CHANNEL, limit: 5 });
const flag = (hist.messages ?? []).find(m => m.text?.includes('Due while away'));
check('at-risk flag posted to channel', !!flag, flag?.text?.slice(0, 90));

// 5. Canvas shows the OOO section; whosOut lists the user.
const sync = await syncChannelCanvas(db, webCanvasClient(client), CHANNEL);
check('canvas synced', sync.ok, sync.error);
check('whosOut lists the user', whosOut(db, now).includes(`<@${USER}>`));

// 6. Cancel ("back early") restores the original nudge time.
const cancel = await handleLeaveMessage(db, llm, sender, messenger,
  { text: "I'm back early — cancel my leave", userId: USER, channelId: CHANNEL }, now);
check('cancellation recognized', !!cancel && /cancelled/.test(cancel.text), cancel?.text);
const restored = await scheduledFor(dm);
check('nudge restored to original time', restored.some(t => before.includes(t)),
  `restored=${JSON.stringify(restored)}`);

// 7. Cleanup: remove scheduled nudge, seeded rows, resync canvas.
const nid = getCommitment(db, c.id)!.nudge_scheduled_id;
if (nid?.includes(':')) {
  const [ch, sid] = nid.split(':', 2);
  await client.chat.deleteScheduledMessage({ channel: ch, scheduled_message_id: sid }).catch(() => {});
}
db.prepare(`DELETE FROM commitments WHERE id = ?`).run(c.id);
db.prepare(`DELETE FROM leaves WHERE user_id = ? AND start_date = ?`).run(USER, start);
await syncChannelCanvas(db, webCanvasClient(client), CHANNEL);
console.log(failures ? `\n${failures} live check(s) FAILED` : '\nAll live checks passed (cleanup done)');
process.exit(failures ? 1 : 0);
