import { loadConfig } from '../src/config.js';
import { createLlmClient } from '../src/llm/client.js';
import { looksLikeLeave, parseLeaveIntent } from '../src/extractor/leave.js';

const cases: { text: string; intent: string; wantDates?: boolean }[] = [
  { text: "I'm on leave July 10-14", intent: 'declare', wantDates: true },
  { text: 'taking a day off tomorrow', intent: 'declare', wantDates: true },
  { text: 'OOO next week, back the Monday after', intent: 'declare', wantDates: true },
  { text: "I'm back early — cancel my leave", intent: 'cancel' },
  { text: "who's out this week?", intent: 'query' },
  { text: 'the holiday promo goes out on Friday', intent: 'none' },
  { text: 'Sarah is on vacation next week, ask Tom instead', intent: 'none' },
];

const llm = createLlmClient(loadConfig());
let failures = 0;
for (const c of cases) {
  if (!looksLikeLeave(c.text)) {
    const ok = c.intent === 'none';
    console.log(`${ok ? '✅' : '❌'} [gate:no-llm] "${c.text}"`);
    if (!ok) failures++;
    continue;
  }
  const r = await parseLeaveIntent(c.text, llm);
  const ok = r.intent === c.intent && (!c.wantDates || (!!r.start_date && !!r.end_date));
  console.log(`${ok ? '✅' : '❌'} "${c.text}" → ${JSON.stringify(r)}`);
  if (!ok) failures++;
}
console.log(failures ? `\n${failures} case(s) failed` : '\nAll leave smoke cases passed');
process.exit(failures ? 1 : 0);
