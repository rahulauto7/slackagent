import pkg from '@slack/bolt';
const { App, Assistant } = pkg;
import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import type { LlmClient } from '../llm/client.js';
import { captureThread, type SlackReader } from './capture.js';
import { syncChannelCanvas, webCanvasClient } from './canvas.js';
import { completeCommitment, markBlocksDone } from './complete.js';
import { scheduleNudge, webNudgeSender } from './nudger.js';
import { handleLeaveMessage, type LeaveMessenger } from './leave.js';
import { isBriefingAsk, isRecallAsk, answerRecall } from './recall.js';
import { onDemandBriefing } from './briefing.js';

export function webLeaveMessenger(client: any): LeaveMessenger {
  return {
    deleteScheduled: (channel, scheduledId) =>
      client.chat.deleteScheduledMessage({ channel, scheduled_message_id: scheduledId }).then(() => {}),
    post: (channel, text) => client.chat.postMessage({ channel, text }).then(() => {}),
  };
}

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
      const text = (event.text ?? '').replace(new RegExp(`<@${context.botUserId}>`, 'g'), '').trim();
      const leave = await handleLeaveMessage(db, llm, webNudgeSender(client), webLeaveMessenger(client),
        { text, userId: (event as any).user, channelId: event.channel });
      if (leave) {
        await client.chat.postMessage({ channel: event.channel, thread_ts: threadTs, text: leave.text });
        for (const ch of leave.channels) await syncChannelCanvas(db, webCanvasClient(client), ch);
        return;
      }
      if (isRecallAsk(text)) {
        const searchContext = async (q: string): Promise<string[]> => {
          if (!config.slackUserToken) return [];
          const res = await client.search.messages({ token: config.slackUserToken, query: q, count: 5 });
          return (res.messages?.matches ?? []).map((m: any) => `${m.username}: ${m.text}`);
        };
        const answer = await answerRecall(db, llm, text, searchContext);
        await client.chat.postMessage({ channel: event.channel, thread_ts: threadTs, text: answer });
        return;
      }
      const reader = webClientReader(client, context.botUserId!);
      const r = await captureThread(db, llm, reader, event.channel, threadTs);
      await client.chat.postMessage({ channel: event.channel, thread_ts: threadTs, text: r.text, blocks: r.blocks });
      if (r.blocks) {
        const sync = await syncChannelCanvas(db, webCanvasClient(client), event.channel);
        if (!sync.ok) await client.chat.postMessage({ channel: event.channel, thread_ts: threadTs,
          text: `⚠️ Captured, but the canvas register couldn't be updated: ${sync.error}` });
      }
      for (const c of r.commitments ?? []) await scheduleNudge(db, webNudgeSender(client), c);
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
  const answerUserQuery = async (client: any, text: string, userId: string,
    say: (msg: any) => Promise<unknown>, setStatus?: (s: string) => Promise<unknown>) => {
    try {
      await setStatus?.('thinking...');
      if (isBriefingAsk(text)) {
        const r = await onDemandBriefing(db, llm, userId, new Date());
        await say({ text: r.text, blocks: r.blocks });
        return;
      }
      const leave = await handleLeaveMessage(db, llm, webNudgeSender(client), webLeaveMessenger(client),
        { text, userId, channelId: '' });
      if (leave) {
        await say(leave.text);
        for (const ch of leave.channels) await syncChannelCanvas(db, webCanvasClient(client), ch);
        return;
      }
      const searchContext = async (q: string): Promise<string[]> => {
        if (!config.slackUserToken) return [];
        const res = await client.search.messages({ token: config.slackUserToken, query: q, count: 5 });
        return (res.messages?.matches ?? []).map((m: any) => `${m.username}: ${m.text}`);
      };
      await say(await answerRecall(db, llm, text, searchContext));
    } catch (e) {
      console.error('assistant failed', e);
      await say(`⚠️ I couldn't answer that: ${(e as Error).message}`);
    }
  };
  const assistant = new Assistant({
    threadStarted: async ({ say, setSuggestedPrompts }) => {
      await say('Hi! Ask me what was decided and why, or what\'s on your plate.');
      await setSuggestedPrompts({ prompts: [
        { title: "What's my day?", message: "What's my day?" },
        { title: 'Decision lookup', message: 'What did we decide about pricing and why?' },
      ] });
    },
    userMessage: async ({ message, say, setStatus, client }) => {
      await answerUserQuery(client, (message as any).text ?? '', (message as any).user, say, setStatus);
    },
  });
  app.assistant(assistant);
  // Top-level DMs (classic Messages tab) never enter an assistant thread, so the
  // Assistant middleware ignores them — answer them through the same routine.
  app.message(async ({ message, say, client }) => {
    const m: any = message;
    if (m.channel_type !== 'im' || m.thread_ts || m.subtype || m.bot_id || !m.user) return;
    await answerUserQuery(client, m.text ?? '', m.user, say);
  });
  return app;
}
