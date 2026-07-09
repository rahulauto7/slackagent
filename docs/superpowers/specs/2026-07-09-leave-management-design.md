# Leave Management (OOO-aware agent) — Design

**Date**: 2026-07-09 · **Target**: working demo by July 12 (challenge closes July 13 5PM PT)

## Problem

FollowThrough keeps nudging people who are on vacation, and the team never learns a
commitment is at risk while its owner is away.

## Scope (decided with user)

1. **OOO-aware agent** — no approvals, no leave balances, no HR workflow.
2. **Entry points**: `@FollowThrough` channel mention AND Assistant pane, one shared parser.
3. **During leave**: nudges reschedule to return morning; commitments due during leave are
   flagged once in their source channel; daily briefings pause.
4. **Detection**: keyword gate + small LLM parser. LLM runs only when the gate hits;
   `intent: "none"` falls through to normal capture — zero regression risk.

Out of scope (YAGNI): approval workflows, balances/types, calendar UI, reassignment
buttons, multiple concurrent leaves per user, per-user timezones (server-local 09:00
convention from `computeNudgePostAt` applies).

## Data model

```sql
CREATE TABLE IF NOT EXISTS leaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  start_date TEXT NOT NULL,             -- YYYY-MM-DD
  end_date TEXT NOT NULL,               -- YYYY-MM-DD, inclusive
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
  channel_id TEXT NOT NULL DEFAULT '',  -- where declared; '' = Assistant pane
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

One active leave per user (declaring again replaces). Return = day after `end_date`, 09:00.

`src/store/leaveStore.ts`: `insertLeave`, `cancelActiveLeaves(db, userId)`,
`getLeaveCovering(db, userId, dateIso)`, `listLeavesOverlapping(db, startIso, endIso)`.

## Intent parsing — `src/extractor/leave.ts`

- `looksLikeLeave(text)`: case-insensitive phrase regex (on leave, ooo, out of office,
  vacation, pto, holiday, time off, day off, i'm out, back early, cancel my leave,
  who's out, …). Broad on purpose; the LLM is the second filter.
- `parseLeaveIntent(text, llm, now)`: JSON-only LLM call (same pattern as
  `extractor/prompt.ts`, zod-validated like `extractor/schema.ts`) →
  `{ intent: 'declare'|'cancel'|'query'|'none', start_date, end_date }`,
  dates anchored to today, never in the past. Single day → start == end.

## Flows — `src/slack/leave.ts`

**declareLeave**: replace active leave → reschedule affected nudges (delete `dm:sid`
scheduled message, reschedule at return 09:00 via existing `NudgeSender`,
`setNudgeScheduledId`) → one ⚠️ flag post per channel listing commitments due during
leave → resync affected canvases → confirmation summary.

**cancelLeave** ("I'm back early"): cancel active leave → recompute each open
commitment's nudge with `computeNudgePostAt` (reschedule if future, clear if past) →
resync canvases → confirm.

**whosOut**: leaves overlapping [today, today+7], one line per person with their
commitments due during leave.

## Wiring

- `app.ts` `app_mention`: `looksLikeLeave` → `parseLeaveIntent` → flow; `none` → existing
  `captureThread` unchanged.
- Assistant pane: `isBriefingAsk` → `looksLikeLeave` → recall (existing order preserved).
- `nudger.ts` `scheduleNudge`: owner on leave at fire time → schedule at return 09:00.
  `buildWeeklyDigest`: add "🏖️ Out this week" section.
- `briefing.ts`: `runDailyBriefings` skips users on leave; `onDemandBriefing` shows a
  leave banner to an on-leave asker.
- `canvas.ts`: "🏖️ Out of office" section for owners of the channel's open commitments
  with leave overlapping the next 14 days.
- Stretch only: read-only `whos_out` MCP tool.

## Testing

TDD per module: `tests/store/leaveStore.test.ts`, `tests/extractor/leave.test.ts`
(gate positives/negatives + FakeLlm parses), `tests/slack/leave.test.ts` (fake sender:
nudges moved, one flag per channel, cancel restores), plus extensions to existing
nudger/briefing/canvas tests. Full suite must stay green.

Live verification: declare in sandbox channel with a due-during-leave commitment →
confirmation, channel flag, canvas section, `chat.scheduledMessages.list` shows the move;
"who's out this week?" in pane; briefing skip via `scripts/trigger-briefing.ts`;
"I'm back early" restores; normal capture threads still capture.
