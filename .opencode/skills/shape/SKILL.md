---
name: shape
description: Dar forma a ideas vagas antes de implementar — explorar la necesidad real, fijar el apetito, esbozar la solución y eliminar rabbit holes.
---

## Overview

Shaping is the upstream work that happens before implementation. Its output is not code — it is a one-page document that gives a team enough clarity to build without constant clarifying questions, while leaving room for creativity in the implementation details. Inspired by Basecamp's Shape Up methodology.

A shaped idea has: a bounded problem, an agreed appetite (time budget), a rough solution sketch, and explicit no-gos.

---

## When to Use

- When a request arrives as "we should add X" with no further specification
- Before writing a technical spec, ticket, or implementation plan
- When estimating a feature whose scope keeps growing during discussion
- When a team is about to start a sprint on something fuzzy

## When NOT to Use

- For bugs with a clear, isolated reproduction — fix them directly
- For routine tasks with an established pattern (adding a new CRUD endpoint, updating a dependency)
- For spikes/research tasks — those are shaped differently (timebox + defined output)

---

## Step-by-Step Process

### Step 1 — Explore: Find the Real Problem

Never accept the stated solution as the problem. Dig for the underlying need.

Questions to ask:
- "What are you trying to accomplish?" (not "what feature do you want?")
- "Who does this? In what situation? How often?"
- "What happens today without this? What workaround are they using?"
- "What would make this request unnecessary?"

**Example:**
- Stated request: *"Add a notification bell to the header"*
- Exploration questions: Who needs to be notified? Of what events? How urgently? Do they currently miss things?
- Real problem: *"Support agents miss new ticket assignments because they have to manually refresh the queue"*

The real problem may have a simpler, different, or better solution than the stated request.

### Step 2 — Set the Appetite (Time Budget)

Appetite is how much time the team is **willing to spend**, not how long the work will take. Fix the budget first; fit the solution into it.

| Size | Budget | Appropriate for |
|------|--------|----------------|
| S — Small | 1–4 hours | Single-screen change, trivial workflow |
| M — Medium | 1–2 days | New page or feature within existing system |
| L — Large | 1 week | New subsystem, significant user-facing flow |
| XL — Big Batch | 2–6 weeks | Architectural change, new product area |

**Crucially:** if the idea cannot fit into the agreed appetite at acceptable quality, either scope it down or defer it — do not increase the budget.

### Step 3 — Sketch the Solution

Use a **breadboard** (flow sketch) or **fat marker sketch** (very rough layout). No wireframes. No pixel precision. No Figma mockups at this stage — those come later, after shaping is done.

**Breadboard notation:**
```
[Places]           [Affordances]         [Connection lines]
Queue page    ──▶  "Mark as mine" btn ──▶  Assignment modal
                   "Filter" btn       ──▶  Filter panel
              ◀──  "Back" link

Assignment modal:
  - Agent dropdown (search)
  - Priority selector
  - "Assign" button ──▶ Queue page (updated)
```

A breadboard captures the flow and what elements are needed — nothing more.

**Fat marker sketch** (described in words, not drawn):
> Three-panel layout on desktop: sidebar list of tickets, center pane is ticket detail, right pane is assignment widget. On mobile: list → detail (full screen) → back button. No separate assignment page — it's an inline panel.

### Step 4 — Identify Rabbit Holes

Rabbit holes are places where the work could expand unexpectedly. Name them explicitly so the team can avoid or timebox them.

Template for each rabbit hole:
- **The trap:** What could go wrong or balloon?
- **The boundary:** What we will NOT solve in this cycle

**Example rabbit holes for the notification feature:**
| Rabbit hole | Boundary |
|-------------|----------|
| Real-time updates via WebSocket | Ship with polling (5s interval) first; WebSocket is a separate cycle |
| Notification preferences per agent | Out of scope — all agents get all assignment notifications |
| Mobile push notifications | Out of scope — browser-only in v1 |
| Notification history pagination | Show last 20; no pagination in v1 |

### Step 5 — Define the No-Gos

Explicit no-gos prevent scope creep. They communicate what a team member should not build even if they think of a "nice addition."

```
NO-GOs for this cycle:
- Notification grouping (e.g., "5 new tickets" collapsed)
- Read/unread persistence across devices
- Email digest for missed notifications
- Sound or desktop notification alerts
- Admin controls for notification types
```

### Step 6 — Write the Shape Document

One page. No more. If it takes more than one page, the idea isn't shaped yet — it's still raw.

```markdown
## Shape: Real-Time Ticket Assignment Notifications

**Problem**
Support agents miss new ticket assignments because the queue requires manual refresh.
This causes SLA violations during peak hours.

**Appetite**  M — 2 days

**Solution Sketch**
- Polling endpoint `GET /api/notifications/unread-count` every 5 seconds
- Bell icon in header shows badge count when > 0
- Clicking bell opens dropdown: last 20 notifications, each links to the ticket
- Mark-all-read clears the badge; individual read on click

**Breadboard**
Header bell ──▶ Notification dropdown ──▶ Ticket detail page
                "Mark all read" btn  ──▶ Badge clears

**Rabbit Holes**
- WebSocket: use polling; WS is a separate cycle
- Preferences: all agents get all assignment events — no settings

**No-Gos**
- Grouping, pagination, sound alerts, email digest, admin controls
```

### When Shaping Is Done

The shape document is done when:
- A developer can start without asking "but what about...?" questions
- The team agrees the solution fits within the appetite
- All rabbit holes are either resolved or explicitly deferred
- The no-gos are written and agreed

Hand off the shape doc — not a Jira ticket, not a Figma file — as the starting point for implementation planning.

---

## Verification Checklist

- [ ] Real problem (not just stated request) is clearly articulated
- [ ] Appetite set in time units (hours/days) and agreed by stakeholders
- [ ] Solution sketch uses breadboard or fat-marker description — no wireframes
- [ ] Every identified rabbit hole has a named boundary or deferral
- [ ] No-gos are explicit and signed off
- [ ] Shape doc fits on one page
- [ ] A developer reading it can start work without clarifying questions
- [ ] Implementation details (exact UI, API design) are intentionally left open for the builder
