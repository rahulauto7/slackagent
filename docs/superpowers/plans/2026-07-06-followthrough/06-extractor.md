# Task 06: Extractor — Zod schema, prompt, retry-then-refuse

Global constraints: see `00-overview.md`.

**Files:**
- Create: `src/extractor/schema.ts`, `src/extractor/prompt.ts`, `src/extractor/extract.ts`
- Test: `tests/extractor/extract.test.ts`

**Interfaces:**
- Consumes: `LlmClient` (Task 05).
- Produces (`schema.ts`): `ExtractionSchema` (Zod) and `type Extraction = { decisions: { what: string; rationale: string; decided_by: string }[]; commitments: { owner: string; task: string; deadline: string | null }[] }`.
- Produces (`extract.ts`): `extract(threadText: string, llm: LlmClient): Promise<Extraction>` — one retry with the Zod error appended; throws `ExtractionParseError` on second failure. Strips ```json fences before parsing. Empty arrays are a valid result.
- Produces (`prompt.ts`): `SYSTEM_PROMPT: string`, `userPrompt(threadText: string): string`.

- [ ] **Step 1: Write the failing test**

`tests/extractor/extract.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { extract, ExtractionParseError } from '../../src/extractor/extract.js';
import { FakeLlm } from '../helpers/fakeLlm.js';

const good = JSON.stringify({
  decisions: [{ what: 'Ship v1 Friday', rationale: 'demo deadline', decided_by: 'Priya' }],
  commitments: [{ owner: 'Sam', task: 'send deck', deadline: '2026-07-10' }],
});

describe('extract', () => {
  it('parses valid JSON on first try', async () => {
    const llm = new FakeLlm([good]);
    const r = await extract('thread text', llm);
    expect(r.decisions[0].what).toBe('Ship v1 Friday');
    expect(llm.calls).toHaveLength(1);
  });
  it('strips markdown fences', async () => {
    const llm = new FakeLlm(['```json\n' + good + '\n```']);
    const r = await extract('t', llm);
    expect(r.commitments[0].owner).toBe('Sam');
  });
  it('treats empty arrays as valid (no-decision thread)', async () => {
    const llm = new FakeLlm([JSON.stringify({ decisions: [], commitments: [] })]);
    const r = await extract('t', llm);
    expect(r.decisions).toEqual([]);
  });
  it('retries once with the validation error appended', async () => {
    const llm = new FakeLlm(['{"decisions": "not an array"}', good]);
    const r = await extract('t', llm);
    expect(r.decisions).toHaveLength(1);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].user).toMatch(/decisions/);
  });
  it('throws ExtractionParseError after second failure', async () => {
    const llm = new FakeLlm(['garbage', 'still garbage']);
    await expect(extract('t', llm)).rejects.toThrow(ExtractionParseError);
    expect(llm.calls).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/extractor/extract.test.ts` — Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/extractor/schema.ts`:
```ts
import { z } from 'zod';

export const ExtractionSchema = z.object({
  decisions: z.array(z.object({
    what: z.string().min(1),
    rationale: z.string(),
    decided_by: z.string(),
  })),
  commitments: z.array(z.object({
    owner: z.string().min(1),
    task: z.string().min(1),
    deadline: z.string().nullable(),
  })),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
```

`src/extractor/prompt.ts`:
```ts
export const SYSTEM_PROMPT = `You extract decisions and commitments from Slack threads or meeting notes.
Return ONLY a JSON object: {"decisions":[{"what","rationale","decided_by"}],"commitments":[{"owner","task","deadline"}]}.
Rules:
- A decision is something the group settled on; include the stated rationale ("" if none) and who decided ("" if unclear).
- A commitment is a person agreeing to do a specific thing. "owner" is the name/handle as written.
- "deadline": "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" if stated or clearly implied, else null. Never invent one.
- If nothing was decided or committed, return {"decisions":[],"commitments":[]}. Do NOT force output.
- No prose, no markdown, JSON only.`;

export function userPrompt(threadText: string): string {
  return `Thread:\n"""\n${threadText}\n"""`;
}
```

`src/extractor/extract.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/extractor/extract.test.ts` — Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/extractor tests/extractor
git commit -m "feat: extractor with Zod validation and retry-then-refuse"
```
