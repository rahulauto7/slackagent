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
4. **Complete** — every surface that shows an open commitment (capture summary card, nudge DM, daily briefing) carries a per-commitment "Mark done ✅" button; one click closes it out.
5. **Recall** — user asks in the assistant thread ("what did we decide about pricing and why?"); agent answers with the decision, rationale, and permalink citations.
6. **Daily Briefing** — every workday morning (9:00 AM workspace-local), each user with open commitments gets a structured DM: their timetable for the day, so they start work with a clear picture without asking anyone. Also available on demand ("what's my day?" in the assistant thread). Sections:
   - Overdue commitments (flagged).
   - Due today.
   - Due this week (preview).
   - Decisions made in their channels since their last briefing (context).
   - A short LLM-composed 1–2 sentence "today's focus" line on top.
   - Users with nothing open get no DM (no noise); on-demand ask returns a "you're clear" message.
7. **MCP server** — read-only HTTP MCP server exposing the same store:
   - `search_decisions(query)` — full-text search over decisions.
   - `list_open_commitments(user?)` — open commitments, optionally filtered by owner.
   - `get_decision(id)` — full record with rationale and source link.

### Out of scope (v1)

- Passive listening to all channel messages (privacy risk, noise). The agent acts **only when invoked**.
- External tool integrations (Jira, Linear, calendars).
- Audio/video transcription.
- Multi-workspace administration.
- Editing/completing commitments via MCP (MCP surface is read-only).
- Natural-language completion ("I finished the deck" in the assistant thread). v1 completes only via explicit buttons; LLM matching of free text to open commitments is a stretch goal.

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

```
users(user_id PRIMARY KEY, last_briefed_at TEXT NULL)
```

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

- On capture, each commitment with a deadline gets one nudge DM: 24h before the deadline when it has a time, or 9:00 AM workspace-local on the deadline day when it is date-only.
- Weekly cron (Mon 9:00) posts a per-channel digest: overdue and due-this-week commitments; commitments with no deadline are flagged here instead of nudged.

### Complete

1. Every open commitment rendered in Block Kit (capture summary card, nudge DM, daily briefing) gets its own "Mark done ✅" button carrying the commitment `id` in the action value. Any workspace member can click it — teammates closing things out for each other is normal.
2. One shared action handler: `UPDATE commitments SET status='done'`; if `nudge_scheduled_id` is set and the nudge hasn't fired yet, cancel it via `chat.deleteScheduledMessage`; re-sync the channel canvas; update the source message so the button is replaced with "✅ Done (by @who)".
3. Status lifecycle: `open → done` (button), `open → slipped` (the weekday 9:00 cron flips any open commitment whose deadline has passed, before briefings are built), `slipped → done` (button still works — late is better than never). Briefings and digests treat `slipped` as "overdue".

### Daily Briefing

1. Weekday cron at 9:00 AM workspace-local: query the store for users with open commitments.
2. Per user: build sections (overdue / due today / due this week / recent decisions in channels where they have commitments) from SQLite — no LLM needed for the data.
3. DeepSeek composes the one-line "today's focus" summary from those sections.
4. Send as a Block Kit DM. On-demand path: same builder triggered from the assistant thread ("what's my day?" is a suggested prompt); on-demand works even when the user has nothing open ("you're clear today").
5. Record `last_briefed_at` per user so "decisions since last briefing" has a boundary.

## Error handling

- Every external call (Slack Web API, DeepSeek, canvas) is wrapped; failures produce a clear user-facing message about what couldn't be done. The agent never fails silently.
- LLM output is never trusted raw: schema validation, one retry, then graceful refusal.
- Missing deadline → commitment stored with `deadline = NULL`, excluded from nudges, surfaced in the weekly digest.
- Canvas write failure → capture still succeeds (store is the source of truth); reply notes the canvas couldn't be updated.
- `chat.deleteScheduledMessage` failure on completion (nudge already sent or ID expired) → completion still succeeds; a stray nudge arriving for a done commitment is harmless.
- MCP server errors return proper MCP error responses; it can be restarted independently of stored data.

## Testing

- **Extractor:** ~10 fixture threads (messy realistic conversations, including no-decision threads and ambiguous owners); assert extracted structure. LLM-dependent tests run against recorded responses where possible; a small live smoke test script for the real API.
- **Schema/store:** unit tests for Zod validation, SQLite writes, FTS queries.
- **MCP:** tool-level tests calling the three tools against a seeded database.
- **End-to-end:** scripted manual demo run in the sandbox workspace (doubles as video rehearsal).

## Demo video plan (<3 min)

1. Messy decision thread in-channel → `@FollowThrough` → summary card appears.
2. Channel canvas updates with the decision register.
3. Next morning: owner opens Slack to a **Daily Briefing** DM — their day laid out, no one asked.
4. Owner receives a nudge DM about their commitment, clicks **Mark done ✅** — canvas register updates live.
5. Assistant thread: "what did we decide about X and why?" → cited answer.
6. Finale: Claude Desktop queries the same decision log **from outside Slack** via the MCP server.

## Risks

- **Extraction quality** — mitigated by fixtures-first prompt iteration and honest "nothing found" behavior.
- **Slack API surface unfamiliarity** (canvas API, Assistant class) — mitigated by building capture (core) first; canvas and nudges layer on and can be cut without breaking the demo's spine.
- **Time (8 days)** — layered build order matches the demo: capture → register → chase + complete → briefing → recall → MCP. Each layer is independently demoable; the Daily Briefing reads only from the store, so it layers on without touching capture.
