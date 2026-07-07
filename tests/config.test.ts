import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { LLM_BASE_URL: 'https://api.deepseek.com', LLM_MODEL: 'deepseek-chat', LLM_API_KEY: 'k' };

describe('loadConfig', () => {
  it('loads LLM vars and defaults', () => {
    const c = loadConfig(base);
    expect(c.llmModel).toBe('deepseek-chat');
    expect(c.dbPath).toBe('./followthrough.db');
    expect(c.mcpPort).toBe(3920);
    expect(c.slackBotToken).toBe('');
  });
  it('throws when an LLM var is missing', () => {
    expect(() => loadConfig({ ...base, LLM_API_KEY: undefined })).toThrow(/LLM_API_KEY/);
  });
});
