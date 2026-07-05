# FollowThrough — Decision & Commitment Memory Agent for Slack

**Date:** 2026-07-05
**Target:** Slack Agent Builder Challenge — *Agent for Organizations* track
**Deadline:** July 13, 2026, 5:00 PM PT (submission on Devpost)
**Status:** Approved design

## Problem

Teams make decisions in meetings and Slack threads, then lose them. Commitments ("I'll send that by Friday") evaporate. Weeks later nobody remembers what was decided, why, or who owed what. FollowThrough makes **decisions** and **commitments** first-class objects in Slack: captured on demand, kept in a living register, chased until done, and recallable with full context.

## Hackathon fit

- **Track:** Agent for Organizations (business/enterprise value).
- **Qualifying capabilities (rules require ≥1; we use all three):**
  1. Slack AI capabilities — built on Slack's AI-app surface (Bolt `Assistant` class: assistant threads, suggested prompts, status indicators).
  2. MCP server integration — FollowThrough *exposes* an MCP server so external agents (Claude Desktop/Code, IDEs) can query the org's decision log.
  3. Slack search API — used to gather surrounding context during recall.
- **Judging criteria mapping:** software quality (typed codebase, tests, schema-validated LLM output), UX (canvas register, nudges, assistant thread with suggested prompts), community impact (universal org pain, clear ROI story), creativity (decision log as queryable agent infrastructure via MCP).
- **Submission deliverables:** working sandbox workspace access, <3-minute demo video, architecture diagram, text description, track ID.

## Scope

### In scope (v1)

1. **Capture** — `@FollowThrough` mentioned in a thread, or pasted meeting notes in its DM/assistant thread, extracts structured records:
   - *Decisions:* what was decided, rationale, who decided, source permalink.
   - *Commitments:* owner (Slack user), task, deadline (if stated), source permalink.
2. **Register** — one Slack canvas per channel, auto-updated on every capture: current decisions and open/done commitments.
3. **Chase** — scheduled DM nudge to each commitment owner before its deadline (via `chat.scheduleMessage`); weekly "what's slipping" digest posted to the channel (cron).
4. **Recall** — user asks in the assistant thread ("what did we decide about pricing and why?"); agent answers with the decision, rationale, and permalink citations.
5. **MCP server** — read-only HTTP MCP server exposing the same store:
   - `search_decisions(query)` — full-text search over decisions.
   - `list_open_commitments(user?)` — open commitments, optionally filtered by owner.
   - `get_decision(id)` — full record with rationale and source link.

### Out of scope (v1)

- Passive listening to all channel messages (privacy risk, noise). The agent acts **only when invoked**.
- External tool integrations (Jira, Linear, calendars).
- Audio/video transcription.
- Multi-workspace administration.
- Editing/completing commitments via MCP (MCP surface is read-only).

## Architecture

Single Node.js/TypeScript process, five components:

| Component | Responsibility | Key tech |
|---|---|---|
| Slack app | Events, assistant threads, mentions, replies | Bolt for JS, `Assistant` class, Socket Mode |
| Extractor | Thread/notes text → structured JSON (decisions, commitments) | DeepSeek API (`deepseek-chat`, OpenAI-compatible), Zod schema validation |
| Store | Persistence + full-text search | SQLite (`better-sqlite3`), tables `decisions` and `commitments`, FTS5 index |
| Canvas sync + Nudger | Per-channel canvas register; deadline nudges; weekly digest | Slack canvas API, `chat.scheduleMessage`, `node-cron` |
| MCP server | Read-only external query surface over the store | `@modelcontextprotocol/sdk`, Streamable HTTP transport |

**Why these choices:** Socket Mode avoids public hosting for the sandbox demo; SQLite is a single file shared by the Slack app and MCP server in-process; DeepSeek is the LLM the builder has API access to, and extraction/composition are within its capability.

**LLM provider note:** all LLM calls go through a thin client module so the provider can be swapped (base URL + model name via env vars: `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`).

## Data model

```
decisions(id, channel_id, what TEXT, rationale TEXT, decided_by TEXT,
          source_permalink TEXT, created_at)
commitments(id, channel_id, owner_user_id TEXT, task TEXT,
            deadline TEXT NULL, status TEXT CHECK(open|done|slipped),
            source_permalink TEXT, nudge_scheduled_id TEXT NULL, created_at)
```

FTS5 virtual table over `decisions(what, rationale)` for recall and MCP search.

## Data flows

### Capture

1. App mention in a thread (or notes pasted in DM/assistant thread).
2. Fetch full thread via `conversations.replies`.
3. Extractor prompt → DeepSeek → JSON `{decisions[], commitments[]}`. "Nothing decided here" (both arrays empty) is a valid, expected result.
4. Validate against Zod schema. On failure: one retry with the validation error appended to the prompt; on second failure, reply "couldn't parse this thread" politely.
5. Resolve owner names to Slack user IDs (thread participants first, then `users.list` lookup; unresolvable owner → store raw name, no nudge).
6. Write to SQLite; update the channel's canvas; schedule nudges for commitments with deadlines; reply in-thread with a compact summary card (Block Kit).

### Recall

1. Question arrives in the assistant thread.
2. FTS5 search over the register + Slack `search.messages` for surrounding context.
3. DeepSeek composes an answer citing decision records and permalinks.
4. Reply in assistant thread; set suggested follow-up prompts.

### Chase

- On capture, each commitment with a deadline gets a nudge DM scheduled ~24h before deadline (deadline day at 9:00 workspace-local if the deadline is date-only).
- Weekly cron (Mon 9:00) posts a per-channel digest: overdue and due-this-week commitments; commitments with no deadline are flagged here instead of nudged.

## Error handling

- Every external call (Slack Web API, DeepSeek, canvas) is wrapped; failures produce a clear user-facing message about what couldn't be done. The agent never fails silently.
- LLM output is never trusted raw: schema validation, one retry, then graceful refusal.
- Missing deadline → commitment stored with `deadline = NULL`, excluded from nudges, surfaced in the weekly digest.
- Canvas write failure → capture still succeeds (store is the source of truth); reply notes the canvas couldn't be updated.
- MCP server errors return proper MCP error responses; it can be restarted independently of stored data.

## Testing

- **Extractor:** ~10 fixture threads (messy realistic conversations, including no-decision threads and ambiguous owners); assert extracted structure. LLM-dependent tests run against recorded responses where possible; a small live smoke test script for the real API.
- **Schema/store:** unit tests for Zod validation, SQLite writes, FTS queries.
- **MCP:** tool-level tests calling the three tools against a seeded database.
- **End-to-end:** scripted manual demo run in the sandbox workspace (doubles as video rehearsal).

## Demo video plan (<3 min)

1. Messy decision thread in-channel → `@FollowThrough` → summary card appears.
2. Channel canvas updates with the decision register.
3. Owner receives a nudge DM about their commitment.
4. Assistant thread: "what did we decide about X and why?" → cited answer.
5. Finale: Claude Desktop queries the same decision log **from outside Slack** via the MCP server.

## Risks

- **Extraction quality** — mitigated by fixtures-first prompt iteration and honest "nothing found" behavior.
- **Slack API surface unfamiliarity** (canvas API, Assistant class) — mitigated by building capture (core) first; canvas and nudges layer on and can be cut without breaking the demo's spine.
- **Time (8 days)** — layered build order matches the demo: capture → register → chase → recall → MCP. Each layer is independently demoable.
