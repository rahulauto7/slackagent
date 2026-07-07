import type Database from 'better-sqlite3';
import type { LlmClient } from '../llm/client.js';
import { extract, ExtractionParseError } from '../extractor/extract.js';
import { insertDecision } from '../store/decisionStore.js';
import { insertCommitment } from '../store/commitmentStore.js';
import { resolveOwner, type Member } from './ownerResolution.js';
import { captureSummaryBlocks } from './blocks.js';

export interface SlackReader {
  fetchThread(channelId: string, threadTs: string): Promise<{ userId: string; text: string }[]>;
  listMembers(): Promise<Member[]>;
  getPermalink(channelId: string, ts: string): Promise<string>;
}

export async function captureThread(
  db: Database.Database, llm: LlmClient, reader: SlackReader,
  channelId: string, threadTs: string,
): Promise<{ text: string; blocks?: any[] }> {
  const [msgs, members, permalink] = await Promise.all([
    reader.fetchThread(channelId, threadTs), reader.listMembers(),
    reader.getPermalink(channelId, threadTs),
  ]);
  const byId = new Map(members.map(m => [m.id, m]));
  const threadText = msgs.map(m => `${byId.get(m.userId)?.realName ?? m.userId}: ${m.text}`).join('\n');
  const participants = [...new Set(msgs.map(m => m.userId))]
    .map(id => byId.get(id)).filter((m): m is Member => !!m);

  let extraction;
  try { extraction = await extract(threadText, llm); }
  catch (e) {
    if (e instanceof ExtractionParseError)
      return { text: "Sorry — I couldn't parse this thread into decisions/commitments. Try rephrasing or a shorter excerpt." };
    throw e;
  }
  if (extraction.decisions.length === 0 && extraction.commitments.length === 0)
    return { text: 'Nothing captured — no decisions or commitments found in this thread.' };

  const decisions = extraction.decisions.map(d =>
    insertDecision(db, { channel_id: channelId, ...d, source_permalink: permalink }));
  const commitments = extraction.commitments.map(c =>
    insertCommitment(db, {
      channel_id: channelId, task: c.task, deadline: c.deadline, source_permalink: permalink,
      owner_user_id: resolveOwner(c.owner, participants, members),
    }));
  return { text: `Captured ${decisions.length} decision(s), ${commitments.length} commitment(s).`,
           blocks: captureSummaryBlocks(decisions, commitments) };
}
