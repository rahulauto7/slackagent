import { WebClient } from '@slack/web-api';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/store/db.js';
import { createLlmClient } from '../src/llm/client.js';
import { runDailyBriefings } from '../src/slack/briefing.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const client = new WebClient(config.slackBotToken);
const n = await runDailyBriefings(db, createLlmClient(config), async (userId, text, blocks) => {
  const dm = await client.conversations.open({ users: userId });
  await client.chat.postMessage({ channel: dm.channel!.id!, text, blocks });
}, new Date());
console.log(`briefed ${n} user(s)`);
