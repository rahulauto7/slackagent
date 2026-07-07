# Task 09: Slack sandbox + app setup — HUMAN GATE

Global constraints: see `00-overview.md`.
**This task is performed by the human (Rahul), not an agent.** Do it in parallel with Tasks 01–08 so tokens exist before Task 11. An agent executing this task should write the manifest file, print the checklist, and STOP for the human.

**Files:**
- Create: `slack-app-manifest.json`

- [ ] **Step 1: Write the manifest**

`slack-app-manifest.json`:
```json
{
  "display_information": {
    "name": "FollowThrough",
    "description": "Decision & commitment memory for your team",
    "background_color": "#1a1d29"
  },
  "features": {
    "bot_user": { "display_name": "FollowThrough", "always_online": true },
    "assistant_view": {
      "assistant_description": "Ask what was decided and why, or what's on your plate today.",
      "suggested_prompts": []
    }
  },
  "oauth_config": {
    "scopes": {
      "bot": [
        "app_mentions:read", "assistant:write", "canvases:read", "canvases:write",
        "channels:history", "channels:join", "channels:read", "chat:write",
        "groups:history", "im:history", "im:write", "users:read"
      ]
    }
  },
  "settings": {
    "event_subscriptions": {
      "bot_events": [
        "app_mention", "assistant_thread_started",
        "assistant_thread_context_changed", "message.im"
      ]
    },
    "interactivity": { "is_enabled": true },
    "socket_mode_enabled": true,
    "org_deploy_enabled": false,
    "token_rotation_enabled": false
  }
}
```

- [ ] **Step 2: Human checklist (do in order)**

1. Join the Slack Developer Program and create a **developer sandbox workspace**: https://api.slack.com/developer-program (submission requires giving judges access to this sandbox).
2. https://api.slack.com/apps → **Create New App** → *From a manifest* → pick the sandbox workspace → paste `slack-app-manifest.json` (JSON tab) → Create.
3. **Settings → Socket Mode**: confirm enabled; under **Basic Information → App-Level Tokens** create token `followthrough-socket` with scope `connections:write`. Copy the `xapp-...` token.
4. **Install App** → *Install to Workspace* → authorize. Copy the `xoxb-...` bot token.
5. `cp .env.example .env` (if not already) and fill `SLACK_BOT_TOKEN=xoxb-...`, `SLACK_APP_TOKEN=xapp-...` plus the DeepSeek values.
6. In the sandbox, create channel `#proj-demo` and `/invite @FollowThrough`.
7. Optional (recall context enrichment): create a user token with `search:read` (OAuth user scope) and set `SLACK_USER_TOKEN=xoxp-...` in `.env`. Recall works without it — `search.messages` needs a user token, so the code treats it as best-effort.
8. If the assistant pane doesn't appear later: app settings → **Agents & AI Apps** → enable, then reinstall the app.

- [ ] **Step 3: Verify tokens**

Run:
```bash
set -a && source .env && set +a && npx tsx -e "
const r = await fetch('https://slack.com/api/auth.test', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.SLACK_BOT_TOKEN } });
console.log(await r.json());"
```
Expected: `{ ok: true, ... team: '<sandbox>', user: 'followthrough' ... }`.

- [ ] **Step 4: Commit**

```bash
git add slack-app-manifest.json
git commit -m "chore: Slack app manifest and setup checklist"
```
