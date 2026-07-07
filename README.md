# FollowThrough

Slack conversations produce decisions and commitments constantly — and then lose them.
FollowThrough makes them first-class Slack objects: mention `@FollowThrough` on any thread
and it extracts what was decided (and why) and who committed to what (and by when), writes
everything to a per-channel **canvas register**, schedules **deadline nudges**, sends a
**daily briefing** DM, answers **"what did we decide about X?"** with cited sources in the
assistant pane, and exposes the whole log to external agents over a read-only **MCP server**.

Capture → register → chase → complete → recall → briefing → MCP. Nothing falls through.

## Hackathon

- **Event:** Slack Agent Builder Challenge (Devpost), deadline July 13, 2026 5:00 PM PT.
- **Track:** *Agent for Organizations*.
- **Qualifying capabilities used:** Slack AI `Assistant` class (assistant pane with suggested
  prompts + status), an MCP server exposing org knowledge to external agents, and the Slack
  `search.messages` API for recall context.

## Setup

1. `npm install`
2. Create the Slack app: [slack-app-manifest.json](slack-app-manifest.json) — create an app
   from manifest at api.slack.com/apps, install it to your workspace, generate an app-level
   token with `connections:write`. Step-by-step:
   [docs/superpowers/plans/2026-07-06-followthrough/09-slack-setup.md](docs/superpowers/plans/2026-07-06-followthrough/09-slack-setup.md)
3. `cp .env.example .env` and fill in:
   - `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` — any OpenAI-compatible endpoint
     (built and demoed against DeepSeek `deepseek-chat`)
   - `SLACK_BOT_TOKEN` (xoxb, from the installed app) and `SLACK_APP_TOKEN` (xapp)
   - `SLACK_USER_TOKEN` (optional, `search:read`) — enriches recall answers with
     workspace search context; everything else works without it
   - `DB_PATH` (default `./followthrough.db`), `MCP_PORT` (default `3920`)
4. `npm run dev` — one process runs the Bolt Socket Mode app, the cron jobs, and the MCP
   server. Expected log line: `FollowThrough running — Slack connected, MCP on :3920`.

## Usage

- **Capture:** invite the bot to a channel, then reply `@FollowThrough` on any thread.
  You get a summary card — decisions with rationale, commitments with owner/deadline and a
  **Mark done ✅** button.
- **Register:** each channel gets a canvas (`📒 FollowThrough Register`) that re-syncs on
  every capture and completion: Decisions, Open commitments (overdue flagged ⚠️), Done.
- **Chase:** commitments with a resolved owner and future deadline get a scheduled DM nudge
  (24h before a datetime deadline; 9:00 local for date-only). Mondays 9:00 each channel gets
  a digest of overdue / due-this-week / no-deadline items.
- **Briefing:** weekdays 9:00 every owner with open commitments gets a DM — LLM focus line,
  overdue / due today / due this week (each with Mark done), decisions since last briefing.
- **Recall:** open the FollowThrough assistant pane and ask "What did we decide about
  pricing and why?" — answers come only from recorded decisions, with permalink citations.
  "What's my day?" returns the on-demand briefing.
- **MCP:** point any MCP client (e.g. Claude Desktop → Settings → Connectors) at
  `http://localhost:3920/mcp` (Streamable HTTP). Read-only tools: `search_decisions`,
  `list_open_commitments`, `get_decision`.

## Testing

- `npm test` — offline suite (vitest; LLM faked, Slack faked, in-memory SQLite).
- `npm run smoke:extractor` — live extraction smoke against the configured LLM over
  10 fixture threads (clear decisions, buried commitments, banter, ambiguity).

## Architecture

Single Node.js/TypeScript process; SQLite (FTS5) is the source of truth; every LLM output is
Zod-validated with one retry, then graceful refusal. Details and diagram:
[docs/architecture.md](docs/architecture.md).
