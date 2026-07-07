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
