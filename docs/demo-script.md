# Demo video shot list (< 2:45)

Rehearse once end-to-end with `npm run dev` running, `#proj-demo` cleared (delete
`followthrough.db*` and the old canvas first), and the assistant pane pinned.

| Time | Shot | Script |
|---|---|---|
| 0:00 | Hook — Slack channel scrolling | "Your team makes decisions and promises in Slack every day — and loses them by Friday. FollowThrough makes them impossible to lose." |
| 0:20 | Capture | Post the messy 5-message thread (below). Reply `@FollowThrough`. Card appears: decision + rationale, commitment with owner/deadline, **Mark done ✅**. "One mention. It pulled out what we decided, why, and who owes what by when." |
| 0:50 | Canvas | Open the channel canvas `📒 FollowThrough Register`. "Every channel keeps a living register — decisions, open commitments, done. No one maintains it; it maintains itself." |
| 1:10 | Briefing DM | Trigger the briefing (command below). Show the DM: focus line, overdue/due sections. "Every weekday at 9, owners get their day — with the receipts." |
| 1:30 | Mark done | Click **Mark done ✅** in the DM. Show "✅ Done (by @rahul)", canvas item moved to Done. "One click closes the loop — and cancels the pending nudge." |
| 1:50 | Recall | Assistant pane: "What did we decide about billing and why?" → cited answer with permalink. "Institutional memory, with sources — it refuses to make things up." |
| 2:15 | MCP | Claude Desktop connected to `http://localhost:3920/mcp`; ask "search our decision log for billing" → `search_decisions` returns the record. "The same memory is an MCP server — any agent in your org can query it." |
| 2:40 | Close | "FollowThrough — decisions and commitments as first-class Slack objects. Agent for Organizations track. Teams stop paying the forgot-it tax." |

## Demo thread (post as yourself, one message per line)

1. "ok circling back on billing — stripe vs paddle, we need to pick today"
2. "stripe's fees are fine and we already have the account from the beta"
3. "agreed, let's go with Stripe then — the beta account makes it a no-brainer"
4. "cool. I'll wire up the production Stripe account by Friday"
5. "🎉"

Then reply in-thread: `@FollowThrough`

## Briefing trigger (instead of waiting for 9:00)

```bash
set -a && source .env && set +a && npx tsx scripts/trigger-briefing.ts
```

(Flips slipped statuses first, then DMs every owner with open commitments —
same code path as the weekday 9:00 cron.)

## Pre-flight checklist

- [ ] `npx vitest run` and `npm run smoke:extractor` green
- [ ] Fresh DB (`rm -f followthrough.db*`), old canvas deleted, `npm run dev` restarted
- [ ] Bot invited to `#proj-demo`; assistant pane opens with suggested prompts
- [ ] Claude Desktop connector for `http://localhost:3920/mcp` already added
- [ ] Screen recorder at 1080p, Slack sidebar tidy, notifications off
