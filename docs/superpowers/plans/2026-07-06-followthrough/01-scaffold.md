# Task 01: Project scaffold + config module

Global constraints: see `00-overview.md`.

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `.gitignore`, `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env?: NodeJS.ProcessEnv): Config` where `Config = { llmBaseUrl: string; llmModel: string; llmApiKey: string; slackBotToken: string; slackAppToken: string; dbPath: string; mcpPort: number }`. Missing LLM vars throw; missing Slack vars default to `''` (offline tasks must run without Slack creds).

- [ ] **Step 1: Scaffold files**

`package.json`:
```json
{
  "name": "followthrough",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "dev": "tsx src/index.ts",
    "smoke:extractor": "tsx scripts/smoke-extractor.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "@slack/bolt": "^4.2.0",
    "better-sqlite3": "^11.9.0",
    "node-cron": "^3.0.3",
    "openai": "^4.90.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^20.17.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "tests", "scripts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
```

`.env.example`:
```
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
LLM_API_KEY=sk-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
DB_PATH=./followthrough.db
MCP_PORT=3920
```

`.gitignore`:
```
node_modules/
dist/
.env
*.db
```

- [ ] **Step 2: Install**

Run: `npm install` — Expected: lockfile created, no errors.

- [ ] **Step 3: Write the failing test**

`tests/config.test.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts` — Expected: FAIL, cannot find `../src/config.js`.

- [ ] **Step 5: Implement `src/config.ts`**

```ts
export interface Config {
  llmBaseUrl: string; llmModel: string; llmApiKey: string;
  slackBotToken: string; slackAppToken: string;
  dbPath: string; mcpPort: number;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    llmBaseUrl: required(env, 'LLM_BASE_URL'),
    llmModel: required(env, 'LLM_MODEL'),
    llmApiKey: required(env, 'LLM_API_KEY'),
    slackBotToken: env.SLACK_BOT_TOKEN ?? '',
    slackAppToken: env.SLACK_APP_TOKEN ?? '',
    dbPath: env.DB_PATH ?? './followthrough.db',
    mcpPort: env.MCP_PORT ? Number(env.MCP_PORT) : 3920,
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts` — Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example .gitignore src/config.ts tests/config.test.ts
git commit -m "feat: scaffold TypeScript project with config module"
```
