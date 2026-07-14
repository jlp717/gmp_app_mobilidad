## ADDED Requirements

### Requirement: Transition-based market alerts
The system SHALL create alerts from verified market/fund/event transitions, storing the canonical UTC instant, venue timezone, source version and confidence used to schedule them.

#### Scenario: Upcoming XMAD early close
- **WHEN** the verified calendar has an early close and the user enabled close alerts
- **THEN** the notification is scheduled relative to the exceptional close and labels the venue/local times clearly

### Requirement: Stable deduplication and reconciliation
Each alert SHALL have a stable dedupe key derived from user scope, category, entity, event/transition and source version; changed or cancelled source events SHALL update/cancel prior schedules.

#### Scenario: Calendar close time revised
- **WHEN** a source revision changes a previously scheduled closing transition
- **THEN** the old local notification is cancelled and exactly one replacement is scheduled

#### Scenario: Repeated refresh
- **WHEN** foreground/background refresh processes the same unchanged transition multiple times
- **THEN** only one pending/sent alert exists for the dedupe key

### Requirement: User control and alert budget
Market alerts SHALL respect global/category enablement, quiet hours, snooze, mute by venue/instrument, cooldown, severity and a configurable daily budget; critical operational blockers MAY bypass digest but MUST remain auditable.

#### Scenario: Quiet hours
- **WHEN** a non-critical close reminder falls inside quiet hours
- **THEN** it is moved to the next allowed time only if still useful, otherwise it is suppressed with an audit reason

#### Scenario: Daily budget exhausted
- **WHEN** informational alerts exceed the user's daily budget
- **THEN** remaining items are grouped into a digest or suppressed rather than delivered individually

### Requirement: Neutral and explainable alert content
Every alert SHALL state what changed, affected entity, source/as-of, freshness/uncertainty and a safe next step; content MUST NOT use guaranteed-return, FOMO or automatic buy/sell language.

#### Scenario: Degraded market evidence
- **WHEN** an alert is based on permitted degraded evidence
- **THEN** the title/body visibly state that status requires revalidation and do not urge a trade

### Requirement: Best-effort mobile delivery
The product SHALL distinguish scheduled transition time from actual mobile delivery time and MUST NOT promise exact background execution; foreground resume SHALL revalidate pending transitions.

#### Scenario: Operating system delays notification
- **WHEN** Android or iOS delivers a notification after its transition
- **THEN** opening/resuming the app refreshes context and avoids presenting the stale reminder as current

### Requirement: Auditable alert outcomes
The system SHALL record alert creation, update, cancellation, delivery acknowledgement, dismiss, snooze and mute with reason and source version while minimizing sensitive data.

#### Scenario: User dismisses repeated low-value alerts
- **WHEN** a user repeatedly dismisses/mutes a category
- **THEN** analytics can measure relevance without optimizing for trading volume or profit/loss

