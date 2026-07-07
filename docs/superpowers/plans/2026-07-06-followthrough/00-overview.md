# FollowThrough Implementation Plan — Overview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Tasks live in numbered files in this directory; steps use checkbox (`- [ ]`) syntax for tracking. Every task implicitly includes the Global Constraints below.

**Goal:** Build FollowThrough, a Slack agent that captures decisions/commitments from threads, keeps a canvas register, nudges owners, sends daily briefings, answers recall questions, and exposes a read-only MCP server — per the locked spec `docs/superpowers/specs/2026-07-05-followthrough-design.md`.

**Architecture:** Single Node.js/TypeScript process. SQLite (better-sqlite3, FTS5) is the source of truth, shared in-process by the Bolt Slack app and the MCP HTTP server. All LLM calls go through one thin client (DeepSeek via OpenAI-compatible API); every LLM output is Zod-validated with one retry, then graceful refusal.

**Tech Stack:** Node 20+, TypeScript (strict, ESM), `@slack/bolt` (Socket Mode, `Assistant` class), `better-sqlite3`, `zod`, `openai` (SDK pointed at DeepSeek), `node-cron`, `@modelcontextprotocol/sdk`, `vitest`, `tsx`.

**Credential constraint:** DeepSeek API key exists NOW; Slack sandbox/app does NOT exist yet. Tasks 01–08 are fully offline (Task 07 includes one live DeepSeek smoke script). Task 09 is the human Slack-setup gate; Tasks 10–17 need the sandbox.

## Global Constraints

- Deadline: **July 13, 2026, 5:00 PM PT** (Devpost). Build order = demo spine; later tasks are cuttable, earlier ones are not.
- Env var names verbatim from spec: `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`. Slack: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`. Also `DB_PATH` (default `./followthrough.db`), `MCP_PORT` (default `3920`).
- `commitments.status` allowed values exactly: `open | done | slipped` (SQLite CHECK).
- `deadline` is TEXT: date-only `YYYY-MM-DD`, ISO datetime `YYYY-MM-DDTHH:mm` (workspace-local), or NULL.
- Owner convention: `owner_user_id` holds a resolved Slack ID (`/^[UW][A-Z0-9]{2,}$/`) or the raw extracted name when unresolvable. Raw-name owners get **no** nudge/briefing DM; they surface in the weekly digest only.
- LLM output is never trusted raw: Zod validation → one retry with the validation error appended → polite refusal. No silent failures anywhere.
- Timestamps stored as UTC ISO-8601 strings.
- TypeScript `strict: true`; tests with vitest; run TS directly with `tsx`. Package manager: npm. `"type": "module"`.
- **Markdown files must never exceed 200 lines** (user rule). Split docs when needed.

## Task Index

| # | File | Deliverable | Needs |
|---|------|-------------|-------|
| 01 | `01-scaffold.md` | TS project + config module | — |
| 02 | `02-store-db.md` | SQLite schema, CHECK constraint, FTS5 | 01 |
| 03 | `03-store-decisions.md` | Decision queries + FTS search | 02 |
| 04 | `04-store-commitments.md` | Commitment/user queries, slipped-flip | 02 |
| 05 | `05-llm-client.md` | Swappable LLM client + FakeLlm test helper | 01 |
| 06 | `06-extractor.md` | Zod schema, prompt, retry-then-refuse | 05 |
| 07 | `07-fixtures-smoke.md` | 10 fixture threads + live DeepSeek smoke | 06 |
| 08 | `08-mcp-server.md` | Read-only MCP server, 3 tools | 03, 04 |
| 09 | `09-slack-setup.md` | **HUMAN GATE:** sandbox, app manifest, tokens | — |
| 10 | `10-owner-blocks.md` | Owner resolution + Block Kit builders | 04 |
| 11 | `11-capture.md` | Bolt app + capture flow + entrypoint | 06, 09, 10 |
| 12 | `12-canvas.md` | Per-channel canvas register sync | 11 |
| 13 | `13-complete.md` | Mark-done button handler | 12 |
| 14 | `14-chase.md` | Deadline nudges + weekly digest cron | 13 |
| 15 | `15-briefing.md` | Daily Briefing (cron + on-demand) | 14 |
| 16 | `16-recall.md` | Assistant-thread recall with citations | 11 |
| 17 | `17-demo-docs.md` | Demo script, README, architecture diagram | all |

## Execution notes

- Tasks 01–08 can proceed immediately and in order (03/04 parallelizable; 05–07 parallel to 03–04).
- Task 09 requires the human: create the Slack sandbox + app from the provided manifest, paste tokens into `.env`. Do it while 01–08 are being built so it's ready by Task 11.
- Cut line under time pressure (spec Risks): capture (11) + register (12) are the demo spine; 14/15 cut first, then 16; 08 (MCP) is cheap and high-value for judging — keep.
