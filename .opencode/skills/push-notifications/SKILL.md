---
name: push-notifications
description: Reference checklist for push notifications workflows in the OpenCode team.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  converted_from: push-notifications.md
---

# Push Notifications Skill

## Purpose
Guide agents in implementing push notification systems across mobile (FCM/APNs) and web platforms.

## When to Use
- User mentions push notifications, FCM, APNs, mobile alerts
- Need to implement real-time user notifications
- Building notification preferences or quiet hours
- Multi-channel notification routing

## Key Patterns

### 1. Token Lifecycle Management
- App registers ? gets device token ? send to backend
- On token refresh ? update in backend
- On send failure (410 Gone) ? remove stale token
- Store: user_id, device_token, platform, created_at, last_used

### 2. Multi-Channel Routing
1. Determine notification type and priority
2. Check user preferences (opted channels, quiet hours)
3. Route to primary channel
4. If delivery fails ? fallback to secondary
5. Log delivery attempt and result

### 3. Quiet Hours
- User sets: 22:00 - 08:00
- Notifications queued during quiet hours ? delivered at end time
- Critical notifications (SEV1) bypass quiet hours

### 4. Deduplication
- Hash: user_id + notification_type + content_hash + time_window
- If hash exists in last N minutes ? skip duplicate
- Prevents spam from retry loops

### 5. Batch Delivery
- Group non-urgent notifications into digest
- Send at scheduled times (e.g., daily summary)
- Reduces notification fatigue

## Rules
1. ALWAYS respect user preferences (opt-in/opt-out, quiet hours)
2. ALWAYS implement token refresh handling
3. NEVER use notifications as only critical channel
4. ALWAYS validate tokens before sending
5. NEVER spam — frequency capping mandatory
6. ALWAYS log delivery status and engagement metrics

## Anti-Patterns
- No token refresh ? expired tokens, lost notifications
- No user preferences ? spam, uninstalls
- No deduplication ? same message multiple times
- No fallback channel ? critical notifications lost
- No analytics ? blind system
- Notifications without action ? low engagement

## Implementation Checklist
- [ ] Token registration and refresh handled
- [ ] User preference system in place
- [ ] Quiet hours implemented
- [ ] Deduplication logic active
- [ ] Fallback channel configured
- [ ] Delivery analytics tracking
- [ ] Frequency capping enforced

