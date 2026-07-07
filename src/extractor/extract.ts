import { ExtractionSchema, type Extraction } from './schema.js';
import { SYSTEM_PROMPT, userPrompt } from './prompt.js';
import type { LlmClient } from '../llm/client.js';

export class ExtractionParseError extends Error {}

function stripFences(s: string): string {
  return s.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

function tryParse(raw: string): { ok: true; value: Extraction } | { ok: false; error: string } {
  let json: unknown;
  try { json = JSON.parse(stripFences(raw)); }
  catch (e) { return { ok: false, error: `Invalid JSON: ${(e as Error).message}` }; }
  const result = ExtractionSchema.safeParse(json);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: result.error.message };
}

export async function extract(threadText: string, llm: LlmClient): Promise<Extraction> {
  const first = tryParse(await llm.complete(SYSTEM_PROMPT, userPrompt(threadText)));
  if (first.ok) return first.value;
  const retryUser = `${userPrompt(threadText)}\n\nYour previous output failed validation:\n${first.error}\nReturn corrected JSON only.`;
  const second = tryParse(await llm.complete(SYSTEM_PROMPT, retryUser));
  if (second.ok) return second.value;
  throw new ExtractionParseError(`Extraction failed after retry: ${second.error}`);
}
