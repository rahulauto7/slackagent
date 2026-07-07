import { loadConfig } from './config.js';
import { openDb } from './store/db.js';
import { createLlmClient } from './llm/client.js';
import { createSlackApp } from './slack/app.js';
import { startMcpServer } from './mcp/server.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const llm = createLlmClient(config);
const app = createSlackApp(config, db, llm);
await app.start();
await startMcpServer(db, config.mcpPort);
console.log(`FollowThrough running — Slack connected, MCP on :${config.mcpPort}`);
