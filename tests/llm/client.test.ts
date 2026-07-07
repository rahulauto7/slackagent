import { describe, it, expect } from 'vitest';
import { createLlmClient } from '../../src/llm/client.js';
import { FakeLlm } from '../helpers/fakeLlm.js';

const config = {
  llmBaseUrl: 'https://api.deepseek.com', llmModel: 'deepseek-chat', llmApiKey: 'k',
  slackBotToken: '', slackAppToken: '', slackUserToken: '', dbPath: ':memory:', mcpPort: 3920,
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
