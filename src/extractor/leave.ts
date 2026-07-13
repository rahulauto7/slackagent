import { z } from 'zod';
import type { LlmClient } from '../llm/client.js';
import { stripFences } from './extract.js';

export const LeaveIntentSchema = z.object({
  intent: z.enum(['declare', 'cancel', 'query', 'none']),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});
export type LeaveIntent = z.infer<typeof LeaveIntentSchema>;

const GATE = /\b(ooo|out of office|on leave|be leave|vacation|pto|holiday|time off|day off|back early|cancel my leave|who'?s out|who is out|i'?m out|i am out|(i'?ll|(i )?will) be (out|off|away|leave|leaving|on leave|traveling|gone|ooo)|won'?t be (in|around|available|here))\b/i;

export function looksLikeLeave(text: string): boolean {
  return GATE.test(text.replace(/[‘’]/g, "'"));
}

const SYSTEM = `You classify Slack messages about time off / leave.
Return ONLY a JSON object: {"intent":"declare"|"cancel"|"query"|"none","start_date":"YYYY-MM-DD"|null,"end_date":"YYYY-MM-DD"|null}.
Rules:
- "declare": the author says THEY will be away / on leave / OOO on specific day(s). Fill start_date and end_date (inclusive; single day = same date).
- "cancel": the author says they are back early or wants to cancel their leave.
- "query": asking who is out / on leave.
- "none": anything else (tasks, decisions, someone ELSE being away, general chat).
- Resolve relative dates ("tomorrow", "next week", "Friday") against today's date given by the user; never produce past dates.
- No prose, no markdown, JSON only.`;

const NONE: LeaveIntent = { intent: 'none', start_date: null, end_date: null };

function tryParse(raw: string): LeaveIntent | null {
  let json: unknown;
  try { json = JSON.parse(stripFences(raw)); } catch { return null; }
  const result = LeaveIntentSchema.safeParse(json);
  return result.success ? result.data : null;
}

export async function parseLeaveIntent(text: string, llm: LlmClient, now: Date = new Date()): Promise<LeaveIntent> {
  const user = `Today's date is ${now.toISOString().slice(0, 10)}.\nMessage:\n"""\n${text}\n"""`;
  let parsed = tryParse(await llm.complete(SYSTEM, user));
  if (!parsed) {
    const retry = `${user}\n\nYour previous output was not valid JSON for the required schema. Return corrected JSON only.`;
    try { parsed = tryParse(await llm.complete(SYSTEM, retry)); } catch { parsed = null; }
  }
  if (!parsed) return NONE;
  if (parsed.intent === 'declare' && parsed.start_date && !parsed.end_date)
    return { ...parsed, end_date: parsed.start_date };
  return parsed;
}
