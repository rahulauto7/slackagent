# Task 07: Fixture threads + live DeepSeek smoke test

Global constraints: see `00-overview.md`.
This task validates the plan's riskiest assumption (extraction quality) — run the smoke script EARLY and iterate `src/extractor/prompt.ts` until all fixtures pass.

**Files:**
- Create: `tests/fixtures/threads.json`, `scripts/smoke-extractor.ts`
- Test: `tests/extractor/fixtures.test.ts`

**Interfaces:**
- Consumes: `extract`, `ExtractionParseError` (Task 06), `createLlmClient` (Task 05), `loadConfig` (Task 01).
- Produces: `threads.json` — array of `{ name: string; text: string; expect: { minDecisions: number; minCommitments: number; empty?: boolean } }`.

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/threads.json` (10 entries; messy on purpose — fillers, typos, tangents):
```json
[
  {"name":"clear-decision-with-deadline","text":"Priya: ok after all that back and forth — we're going with Stripe for billing. cheaper at our volume and the API is nicer\nDev: fine by me\nSam: 👍 I'll wire up the test account by Friday July 10\nPriya: great, decided then","expect":{"minDecisions":1,"minCommitments":1}},
  {"name":"standup-no-decisions","text":"Bot: Standup time!\nDev: yesterday: reviews. today: more reviews. blockers: none\nSam: same honestly lol\nPriya: shipping continues","expect":{"minDecisions":0,"minCommitments":0,"empty":true}},
  {"name":"commitment-no-deadline","text":"Ana: someone needs to own the onboarding doc rewrite\nLeo: I can take that one\nAna: thanks leo!!","expect":{"minDecisions":0,"minCommitments":1}},
  {"name":"decision-no-owner-followups","text":"Mo: so are we killing the legacy exporter or not\nJess: yes. it's costing us more than it earns, kill it next sprint\nMo: someone should tell the two customers using it\nJess: yeah… someone should","expect":{"minDecisions":1,"minCommitments":0}},
  {"name":"ambiguous-owner","text":"Kai: the infra team said they'd handle the cert rotation before the 15th\nRhea: which infra person though\nKai: sarah I think? or maybe deepak","expect":{"minDecisions":0,"minCommitments":1}},
  {"name":"meeting-notes-paste","text":"Notes from pricing sync 7/6:\n- agreed: launch price $29/mo, revisit after 90 days (marketing pushed for 19, data said 29 converts fine)\n- Tom to update the pricing page by Wed\n- Aisha to draft the announcement email, no date set\n- parking lot: annual plans","expect":{"minDecisions":1,"minCommitments":2}},
  {"name":"reversed-decision","text":"Nina: earlier we said postgres but heroku pricing changed, let's do the math again\nRaj: ran it — supabase is 40% cheaper for us\nNina: ok switching the plan: supabase it is. final this time\nRaj: 🫡","expect":{"minDecisions":1,"minCommitments":0}},
  {"name":"banter-with-buried-commitment","text":"Zed: did anyone see the game last night\nMel: don't get me started\nZed: 😂 anyway I'll get the demo video recorded before thursday standup\nMel: you said that last week\nZed: this time for real","expect":{"minDecisions":0,"minCommitments":1}},
  {"name":"multiple-decisions","text":"Ivy: wrapping the arch review: we go monorepo, we drop the mobile app from v1 scope, and CI moves to github actions\nBen: rationale for the mobile cut?\nIvy: not enough hands before the deadline, simple as that","expect":{"minDecisions":3,"minCommitments":0}},
  {"name":"question-only-thread","text":"Ola: what's our policy on customer data retention?\nPat: I think legal was looking into it\nOla: so no answer yet?\nPat: not yet","expect":{"minDecisions":0,"minCommitments":0,"empty":true}}
]
```

- [ ] **Step 2: Write the failing structural test**

`tests/extractor/fixtures.test.ts` (offline — validates fixture file shape only):
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('fixture threads', () => {
  const fixtures = JSON.parse(readFileSync('tests/fixtures/threads.json', 'utf8'));
  it('has 10 well-formed fixtures including empty-expectation cases', () => {
    expect(fixtures).toHaveLength(10);
    for (const f of fixtures) {
      expect(f.name).toBeTruthy();
      expect(f.text.length).toBeGreaterThan(20);
      expect(f.expect.minDecisions).toBeGreaterThanOrEqual(0);
    }
    expect(fixtures.filter((f: any) => f.expect.empty)).toHaveLength(2);
  });
});
```

Run: `npx vitest run tests/extractor/fixtures.test.ts` — Expected: PASS (fails only if Step 1 JSON is malformed; fix until green).

- [ ] **Step 3: Write the live smoke script**

`scripts/smoke-extractor.ts`:
```ts
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { createLlmClient } from '../src/llm/client.js';
import { extract, ExtractionParseError } from '../src/extractor/extract.js';

const fixtures = JSON.parse(readFileSync('tests/fixtures/threads.json', 'utf8'));
const llm = createLlmClient(loadConfig());
let failures = 0;

for (const f of fixtures) {
  try {
    const r = await extract(f.text, llm);
    const ok =
      r.decisions.length >= f.expect.minDecisions &&
      r.commitments.length >= f.expect.minCommitments &&
      (!f.expect.empty || (r.decisions.length === 0 && r.commitments.length === 0));
    console.log(`${ok ? '✅' : '❌'} ${f.name}: ${r.decisions.length}d/${r.commitments.length}c`);
    if (!ok) { failures++; console.log(JSON.stringify(r, null, 2)); }
  } catch (e) {
    failures++;
    console.log(`❌ ${f.name}: ${e instanceof ExtractionParseError ? 'parse failure' : e}`);
  }
}
console.log(failures ? `\n${failures} fixture(s) failed` : '\nAll fixtures passed');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 4: Run live smoke against DeepSeek**

Requires `.env` populated with the real `LLM_API_KEY` (exists per plan constraints). Run:
`set -a && source .env && set +a && npm run smoke:extractor`
Expected: `All fixtures passed`, exit 0. If any fixture fails: iterate `SYSTEM_PROMPT` in `src/extractor/prompt.ts` (not the fixtures) and re-run until green. Hallucinated decisions on `empty` fixtures are the failure mode to fight hardest.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures tests/extractor/fixtures.test.ts scripts/smoke-extractor.ts
git commit -m "test: 10 fixture threads and live extractor smoke script"
```
