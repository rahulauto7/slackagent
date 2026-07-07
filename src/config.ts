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
