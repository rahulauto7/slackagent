## Inspiration

Every Slack workspace has the same failure mode: a thread produces a real decision and three "I'll get that done by Friday" promises — and by the next standup, all of it has scrolled away. The knowledge exists, but it lives in chat history where nobody can find it, nothing chases it, and nobody notices when the person who promised it goes on vacation. I wanted decisions and commitments to be first-class objects in Slack, with a lifecycle: **capture → register → chase → complete → recall → briefing → MCP**.

## What it does

Mention `@FollowThrough` on any thread and it extracts what was decided (and why) and who committed to what (and by when). From there:

- **📒 Canvas register** — every channel gets a canvas that re-syncs on each capture/completion: Decisions, Open commitments (overdue flagged ⚠️), Done.
- **⏰ Deadline nudges** — owners get a DM before their deadline, with a *Mark done ✅* button. Mondays, each channel gets a digest of overdue / due-this-week items.
- **📬 Daily briefings** — each owner gets a morning DM: an LLM focus line, what's overdue, due today, due this week, and decisions since the last briefing.
- **🌴 Leave awareness** — tell it "I'm on leave July 14–16" and reminders due while you're away move to your return morning, affected channels get an at-risk flag asking who can cover, your briefing pauses, and the canvas gains an *Out of office* section. "Who's out this week?" answers from the log; "I'm back early" restores everything.
- **🧠 Cited recall** — ask the assistant pane "What did we decide about pricing and why?" and it answers *only* from recorded decisions, with permalink citations. No hallucinated history.
- **🔌 MCP server** — the whole log is exposed to external agents (Claude Desktop, etc.) over read-only Streamable-HTTP tools: `search_decisions`, `list_open_commitments`, `get_decision`.

## How I built it

One Node.js/TypeScript process runs everything: a Bolt Socket Mode app (Slack AI `Assistant` class for the pane, Canvas API for registers, `search.messages` for recall context), node-cron for nudges/digests/briefings, and an MCP server. **SQLite (FTS5) is the source of truth**; the LLM (any OpenAI-compatible endpoint — built against DeepSeek) only ever produces structured output that is **Zod-validated with one retry, then graceful refusal**. If the model can't produce a valid extraction, FollowThrough says so instead of inventing commitments.

## Challenges I ran into

- **LLM reliability**: extraction from messy threads (banter, buried commitments, ambiguity) needed a strict JSON contract, validation, and a refusal path — plus a live smoke suite of fixture threads to catch regressions.
- **Time is hard**: date-only vs. datetime deadlines, per-user timezones, "nudge 24h before" vs. "9:00 local" — all extracted into one shared date utility after it bit me twice.
- **Leave × scheduling**: rescheduling nudges into a leave window, restoring them on early return, and keeping the canvas, briefings, and at-risk flags consistent was the trickiest state management in the project — it ships with an end-to-end live verifier (declare → nudge moves → flag → canvas OOO → cancel → restore).
- **Testing a Slack app offline**: 101 vitest tests run with a faked Slack, faked LLM, and in-memory SQLite, so the whole pipeline is testable without a workspace.

## Accomplishments that I'm proud of

All seven lifecycle stages shipped and demoable in one process: capture, canvas register, nudges, completion, cited recall, briefings, and MCP. Recall that refuses to hallucinate. A leave feature that doesn't just set a status emoji but actually reschedules work around your absence. And a test story I trust: 101 offline tests plus live smoke and end-to-end verifiers.

## What we learned

Keep the deterministic core big and the LLM surface small. Every place the model touches the system is a validated, typed boundary — that's what made the agent trustworthy enough to *act* (schedule, reschedule, flag) rather than just summarize.

## What's next for FollowThrough — the Slack agent that never drops the ball

Jira/Linear sync for commitments, multi-workspace support, and write-tools on the MCP server so external agents can file commitments back into the register.
