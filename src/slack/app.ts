import pkg from '@slack/bolt';
const { App } = pkg;
import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import type { LlmClient } from '../llm/client.js';
import { captureThread, type SlackReader } from './capture.js';

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
    } catch (e) {
      console.error('capture failed', e);
      await client.chat.postMessage({ channel: event.channel, thread_ts: threadTs,
        text: `⚠️ Capture failed: ${(e as Error).message}` });
    }
  });
  return app;
}
