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
