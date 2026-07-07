import pkg from '@slack/bolt';
const { App } = pkg;
import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import type { LlmClient } from '../llm/client.js';
import { captureThread, type SlackReader } from './capture.js';
import { syncChannelCanvas, webCanvasClient } from './canvas.js';
import { completeCommitment, markBlocksDone } from './complete.js';

export function webClientReader(client: any, botUserId: string): SlackReader {
  return {
    async fetchThread(channelId, threadTs) {
      const res = await client.conversations.replies({ channel: channelId, ts: threadTs, limit: 200 });
      return (res.messages ?? [])
        .filter((m: any) => m.user && m.user !== botUserId && m.text)
        .map((m: any) => ({ userId: m.user, text: m.text.replace(new RegExp(`<@${botUserId}>`, 'g'), '').trim() }));
    },
    async listMembers() {
      const res = await client.users.list({ limit: 500 });
      return (res.members ?? []).filter((u: any) => !u.is_bot && !u.deleted)
        .map((u: any) => ({ id: u.id, name: u.name ?? '', realName: u.profile?.real_name ?? '' }));
    },
    async getPermalink(channelId, ts) {
      const res = await client.chat.getPermalink({ channel: channelId, message_ts: ts });
      return res.permalink ?? '';
    },
  };
}

export function createSlackApp(config: Config, db: Database.Database, llm: LlmClient) {
  const app = new App({ token: config.slackBotToken, appToken: config.slackAppToken, socketMode: true });
  app.event('app_mention', async ({ event, client, context }) => {
    const threadTs = (event as any).thread_ts ?? event.ts;
    try {
      const reader = webClientReader(client, context.botUserId!);
      const r = await captureThread(db, llm, reader, event.channel, threadTs);
      await client.chat.postMessage({ channel: event.channel, thread_ts: threadTs, text: r.text, blocks: r.blocks });
      if (r.blocks) {
        const sync = await syncChannelCanvas(db, webCanvasClient(client), event.channel);
        if (!sync.ok) await client.chat.postMessage({ channel: event.channel, thread_ts: threadTs,
          text: `⚠️ Captured, but the canvas register couldn't be updated: ${sync.error}` });
      }
    } catch (e) {
      console.error('capture failed', e);
      await client.chat.postMessage({ channel: event.channel, thread_ts: threadTs,
        text: `⚠️ Capture failed: ${(e as Error).message}` });
    }
  });
  app.action('mark_done', async ({ ack, body, action, client }) => {
    await ack();
    const id = Number((action as any).value);
    const r = await completeCommitment(db,
      (ch, sid) => client.chat.deleteScheduledMessage({ channel: ch, scheduled_message_id: sid }).then(() => {}), id);
    const b: any = body;
    if (!r.ok) {
      await client.chat.postEphemeral({ channel: b.channel.id, user: b.user.id, text: `⚠️ ${r.error}` });
      return;
    }
    if (b.message?.blocks) await client.chat.update({
      channel: b.channel.id, ts: b.message.ts, text: b.message.text ?? 'Updated',
      blocks: markBlocksDone(b.message.blocks, id, b.user.id) });
    await syncChannelCanvas(db, webCanvasClient(client), r.commitment!.channel_id);
  });
  return app;
}
