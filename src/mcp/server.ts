import express from 'express';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { toolSearchDecisions, toolListOpenCommitments, toolGetDecision } from './tools.js';

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

export async function startMcpServer(db: Database.Database, port: number): Promise<{ close(): void }> {
  const app = express();
  app.use(express.json());
  app.post('/mcp', async (req, res) => {
    const server = new McpServer({ name: 'followthrough', version: '0.1.0' });
    server.tool('search_decisions', 'Full-text search over the org decision log',
      { query: z.string() }, async ({ query }) => text(toolSearchDecisions(db, query)));
    server.tool('list_open_commitments', 'Open commitments, optionally filtered by owner Slack user ID',
      { user: z.string().optional() }, async ({ user }) => text(toolListOpenCommitments(db, user)));
    server.tool('get_decision', 'Full decision record with rationale and source link',
      { id: z.number() }, async ({ id }) => text(toolGetDecision(db, id)));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const listener = app.listen(port);
  return { close: () => listener.close() };
}
