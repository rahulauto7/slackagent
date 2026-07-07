import cron from 'node-cron';
import { loadConfig } from './config.js';
import { openDb } from './store/db.js';
import { createLlmClient } from './llm/client.js';
import { createSlackApp } from './slack/app.js';
import { startMcpServer } from './mcp/server.js';
import { buildWeeklyDigest } from './slack/nudger.js';
import { runDailyBriefings } from './slack/briefing.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const llm = createLlmClient(config);
const app = createSlackApp(config, db, llm);
await app.start();
await startMcpServer(db, config.mcpPort);
cron.schedule('0 9 * * 1', async () => {
  const channels = db.prepare(`SELECT DISTINCT channel_id FROM commitments WHERE status IN ('open','slipped')`).all() as { channel_id: string }[];
  for (const { channel_id } of channels) {
    const md = buildWeeklyDigest(db, channel_id, new Date());
    if (md) await app.client.chat.postMessage({ channel: channel_id, text: md, token: config.slackBotToken });
  }
});
cron.schedule('0 9 * * 1-5', async () => {
  await runDailyBriefings(db, llm, async (userId, text, blocks) => {
    const dm = await app.client.conversations.open({ users: userId, token: config.slackBotToken });
    await app.client.chat.postMessage({ channel: dm.channel!.id!, text, blocks, token: config.slackBotToken });
  }, new Date());
});
console.log(`FollowThrough running — Slack connected, MCP on :${config.mcpPort}`);
