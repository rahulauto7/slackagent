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
