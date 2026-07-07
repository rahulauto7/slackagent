# Task 05: LLM client (swappable provider)

Global constraints: see `00-overview.md`.

**Files:**
- Create: `src/llm/client.ts`, `tests/helpers/fakeLlm.ts`
- Test: `tests/llm/client.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 01).
- Produces: `interface LlmClient { complete(system: string, user: string): Promise<string> }` and `createLlmClient(config: Config): LlmClient` (OpenAI SDK pointed at `config.llmBaseUrl`, model `config.llmModel`, temperature 0).
- Produces (test helper): `class FakeLlm implements LlmClient` — constructed with a queue of canned responses; records every `(system, user)` call in `calls`.

- [ ] **Step 1: Write the failing test**

`tests/llm/client.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createLlmClient } from '../../src/llm/client.js';
import { FakeLlm } from '../helpers/fakeLlm.js';

const config = {
  llmBaseUrl: 'https://api.deepseek.com', llmModel: 'deepseek-chat', llmApiKey: 'k',
  slackBotToken: '', slackAppToken: '', dbPath: ':memory:', mcpPort: 3920,
};

describe('llm client', () => {
  it('createLlmClient returns a client without network calls', () => {
    const c = createLlmClient(config);
    expect(typeof c.complete).toBe('function');
  });
  it('FakeLlm replays queued responses and records calls', async () => {
    const fake = new FakeLlm(['one', 'two']);
    expect(await fake.complete('sys', 'a')).toBe('one');
    expect(await fake.complete('sys', 'b')).toBe('two');
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].user).toBe('b');
    await expect(fake.complete('sys', 'c')).rejects.toThrow(/exhausted/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/llm/client.test.ts` — Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/llm/client.ts`:
```ts
import OpenAI from 'openai';
import type { Config } from '../config.js';

export interface LlmClient {
  complete(system: string, user: string): Promise<string>;
}

export function createLlmClient(config: Config): LlmClient {
  const openai = new OpenAI({ baseURL: config.llmBaseUrl, apiKey: config.llmApiKey });
  return {
    async complete(system: string, user: string): Promise<string> {
      const res = await openai.chat.completions.create({
        model: config.llmModel,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      const content = res.choices[0]?.message?.content;
      if (!content) throw new Error('LLM returned empty response');
      return content;
    },
  };
}
```

`tests/helpers/fakeLlm.ts`:
```ts
import type { LlmClient } from '../../src/llm/client.js';

export class FakeLlm implements LlmClient {
  calls: { system: string; user: string }[] = [];
  private queue: string[];
  constructor(responses: string[]) { this.queue = [...responses]; }
  async complete(system: string, user: string): Promise<string> {
    this.calls.push({ system, user });
    const next = this.queue.shift();
    if (next === undefined) throw new Error('FakeLlm exhausted');
    return next;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/llm/client.test.ts` — Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/llm tests/llm tests/helpers
git commit -m "feat: swappable LLM client with fake for tests"
```
