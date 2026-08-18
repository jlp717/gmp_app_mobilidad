---
name: ux-writing
description: UX writing and microcopy — buttons, errors, empty states, toasts, modals, onboarding, accessibility, localization (ES/EN), voice and tone, destructive confirmations, form content, notifications, loading states.
---

# UX Writing — Production-Grade Microcopy Guide

## Overview

UX writing is interface text that guides users through tasks. Unlike marketing copy, it does not sell — it instructs, reassures, and unblocks. Bad microcopy causes support tickets, churn, and accessibility failures. Good microcopy is invisible. This guide covers every surface where strings appear in a production app: buttons, labels, error messages, toasts, modals, empty states, confirmation dialogs, onboarding flows, forms, notifications, loading states, and legal summaries. It also covers localization (Spanish/English) and screen-reader context for accessibility.

## When to Use

- Designing any new screen, modal, form, or flow
- Auditing an existing UI for inconsistent tone or missing states
- Localizing an app from English to Spanish (or vice versa)
- Writing error messages that users actually understand
- Crafting destructive-action confirmations that prevent accidental data loss
- Ensuring screen readers convey the right context beyond visible text

## When NOT to Use

- Do not use UX writing to compensate for broken UX flows — fix the flow first, then write the copy
- Do not write placeholder copy and ship it — "Lorem ipsum" in production is a bug
- Do not write error messages that blame the user ("You entered an invalid email") — blame the system or be neutral
- Do not write copy in isolation — always consider what the user was doing immediately before seeing this text

---

## Step-by-Step Process

### 1. Four Core Principles

Every string in the interface must satisfy these four constraints:

| Principle | Definition | Good | Bad |
|---|---|---|---|
| **Clear** | The user understands what happened and what to do next in one read | "Password must be at least 8 characters" | "Invalid input" |
| **Concise** | No word can be removed without losing meaning | "Save" | "Click here to save your changes" |
| **Actionable** | Every message points to a specific next step | "Check your email for a verification link" | "An error occurred" |
| **Consistent** | The same action uses the same verb everywhere | Always "Delete" (never "Remove" / "Erase" / "Discard" for the same action) | Mixed verbs for identical actions |

### 2. Voice and Tone Guidelines

**Voice** is constant; **tone** shifts with context.

```
Voice (always):  Professional, helpful, human — never robotic, never sarcastic, never blaming
Tone (context):
  Success       → Warm, brief ("Done" not "Operation completed successfully")
  Error         → Neutral, direct ("We couldn't save your changes. Try again.")
  Destructive   → Serious, explicit ("This action cannot be undone.")
  Empty state   → Encouraging, instructive ("Your inbox is empty. Create your first campaign.")
  Loading       → Reassuring ("Fetching your orders…" — never just "Loading…")
```

**Decision tree for tone:**
1. Is the user blocked? → Be direct and provide an immediate next step.
2. Did the user just complete something? → Acknowledge success briefly — do not over-celebrate.
3. Is data about to be destroyed? → Be explicit about irreversibility, require explicit confirmation.
4. Is the user seeing this because nothing exists yet? → Explain the benefit of taking action.

### 3. Microcopy — Buttons, Labels, Placeholders

#### Buttons

Rules:
- Start with a strong verb. Never "Yes" / "No" on action buttons — use the action itself.
- Primary action describes what happens: "Send message", "Create account", "Delete project"
- Secondary/cancel action is always "Cancel" (never "Close", "Dismiss", "Back")
- Never use "Click here" — the button IS the click target

| Context | Primary | Secondary |
|---|---|---|
| Save form | "Save changes" | "Cancel" |
| Delete resource | "Delete project" | "Cancel" |
| Confirm email | "Confirm email" | — |
| Retry after error | "Try again" | "Cancel" |
| Exit onboarding | "Skip" | "Continue" |

```dart
// Flutter — button microcopy pattern
class AppButtonLabels {
  // Primary actions
  static const String save = 'Save changes';
  static const String create = 'Create';
  static const String send = 'Send';
  static const String confirm = 'Confirm';
  static const String delete = 'Delete';
  static const String tryAgain = 'Try again';
  static const String retry = 'Retry';
  static const String continue_ = 'Continue';
  static const String getStarted = 'Get started';
  static const String signIn = 'Sign in';
  static const String signUp = 'Sign up';

  // Secondary / cancel
  static const String cancel = 'Cancel';
  static const String skip = 'Skip';
  static const String notNow = 'Not now';
  static const String goBack = 'Go back';
  static const String dismiss = 'Dismiss';

  // Destructive
  static const String deleteAccount = 'Delete my account';
  static const String removeItem = 'Remove';
  static const String clearAll = 'Clear all';
  static const String signOut = 'Sign out';
}
```

```ts
// TypeScript / React — button label constants
export const BUTTON_LABELS = {
  save: 'Save changes',
  create: 'Create',
  delete: 'Delete',
  confirm: 'Confirm',
  cancel: 'Cancel',
  tryAgain: 'Try again',
  retry: 'Retry',
  skip: 'Skip',
  dismiss: 'Dismiss',
  getStarted: 'Get started',
} as const;
```

#### Labels

- Use sentence case (only first word capitalized): "Email address" not "Email Address"
- Never use placeholder text as the only label — it disappears on focus
- For required fields: append "(required)" — do not rely on color alone (accessibility)
- Group related fields with a legend or section header

```dart
// Input label patterns
'Email address (required)'
'Password'
'Phone number (optional)'
'Delivery address'
```

#### Placeholders

- Use for examples, not instructions
- Format: show expected input shape, not a repeat of the label
- Never put critical instructions only in placeholder text

| Field | Bad placeholder | Good placeholder |
|---|---|---|
| Email | "Enter your email" | "name@company.com" |
| Phone | "Phone number" | "+34 612 345 678" |
| Date | "Select a date" | "DD/MM/AAAA" |
| Amount | "Amount" | "0.00" |

### 4. Error Messages — 4xx, 5xx, Network, Validation

Error messages must answer three questions:
1. **What happened?** (in plain language, not HTTP codes)
2. **Why did it happen?** (if the user can fix it)
3. **What can I do now?** (the next action)

#### Client Errors (4xx)

| HTTP | Scenario | User-facing message |
|---|---|---|
| 400 | Malformed request | "We couldn't process your request. Please try again." |
| 401 | Session expired | "Your session has expired. Please sign in again." |
| 403 | Insufficient permissions | "You don't have permission to view this page." |
| 404 | Resource not found | "We couldn't find what you're looking for." |
| 409 | Duplicate/conflict | "A record with this email already exists." |
| 422 | Validation failed | "Please check the highlighted fields and try again." |
| 429 | Rate limited | "Too many attempts. Please wait a moment and try again." |

#### Server Errors (5xx)

```
Never expose: stack traces, internal paths, database errors, server names.

✅ "Something went wrong on our end. We've been notified and are working on it."
✅ "We're having trouble loading your data. Please try again in a few minutes."

❌ "Error 500: null pointer exception at UserService.ts:42"
❌ "Internal server error"
❌ "Oops! Something broke." (too casual for a production error)
```

#### Network Errors

```
✅ "No internet connection. Check your connection and try again."
✅ "The server is taking too long to respond. Please try again."
✅ "We couldn't reach the server. Check your connection."
```

#### Field Validation Errors

Each validation error must reference the specific field and state the constraint clearly:

```dart
// Flutter validation messages
class FieldValidationMessages {
  // Generic
  static const String required = 'This field is required';

  // Email
  static const String invalidEmail = 'Enter a valid email address';
  static const String emailTaken = 'This email is already in use';

  // Password
  static const String passwordTooShort = 'Password must be at least 8 characters';
  static const String passwordNoMatch = 'Passwords do not match';
  static const String passwordTooWeak = 'Password must include a number and a special character';

  // Numeric
  static const String mustBeNumber = 'Enter a valid number';
  static const String mustBePositive = 'Enter a number greater than zero';
  static const String outOfRange = 'Enter a value between {min} and {max}';

  // Date
  static const String invalidDate = 'Enter a valid date (DD/MM/YYYY)';
  static const String dateInPast = 'Date must be today or later';
  static const String dateInFuture = 'Date must be today or earlier';
}
```

```ts
// Backend validation error format — per-field details
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Please check the highlighted fields and try again.",
    "details": [
      { "field": "email", "message": "Enter a valid email address" },
      { "field": "password", "message": "Password must be at least 8 characters" }
    ]
  }
}
```

#### Error Message Anti-Patterns

| ❌ Don't | ✅ Do |
|---|---|
| "Invalid input" | "Enter a valid email address" |
| "Error 403" | "You don't have permission to do that" |
| "Something went wrong" | "We couldn't save your changes. Try again." |
| "Form submission failed" | "Please check the fields marked in red" |
| "You entered a wrong password" | "Incorrect email or password" (avoid revealing which field is wrong) |

### 5. Success Confirmations

Rules for success messages:
- Be brief — the user wants to move on, not read a celebration
- Name what happened specifically
- Use toasts/snackbars for transient successes; inline confirmation for persistent ones

#### Toast / Snackbar Patterns

```
✅ "Saved"                          (auto-save)
✅ "Changes saved"                   (manual save)
✅ "Message sent"                    (send action)
✅ "File uploaded"                   (upload)
✅ "Invitation sent to name@email.com" (specific context)
✅ "Account created"                 (registration)
✅ "Password updated"                (settings)
✅ "Item added to cart"              (e-commerce)
✅ "Payment confirmed"               (transaction)

❌ "Operation completed successfully"  (too generic)
❌ "Success!"                          (no context — what succeeded?)
❌ "Your changes have been saved successfully. Have a nice day!" (too long)
```

```dart
// Flutter — snackbar helper with consistent success pattern
void showSuccessSnackBar(BuildContext context, String message, {String? actionLabel, VoidCallback? onAction}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message),
      behavior: SnackBarBehavior.floating,
      duration: const Duration(seconds: 4),
      action: actionLabel != null
          ? SnackBarAction(label: actionLabel, onPressed: onAction ?? () {})
          : null,
    ));
}

// Usage
showSuccessSnackBar(context, 'Changes saved');
showSuccessSnackBar(context, 'Invitation sent to ${email}', actionLabel: 'Undo', onAction: undo);
```

### 6. Loading States

Never show a blank screen or an infinite spinner without context.

#### Skeleton Screens vs Spinners

| Pattern | When to use |
|---|---|
| **Skeleton screen** | First load of a page with known layout (list, card grid, profile) |
| **Spinner + label** | Short operations (< 2 seconds): button submitting, file uploading |
| **Progress bar** | Deterministic operations: file upload, report generation |
| **Inline loading** | Loading a section of an already-loaded page |

#### Loading Copy

```
✅ "Loading your orders…"
✅ "Fetching product details…"
✅ "Signing you in…"
✅ "Uploading… 45%"
✅ "Generating report…"
✅ "Sending message…"
✅ "Processing payment…"

❌ "Loading…"                       (too generic)
❌ "Please wait…"                    (wait for what?)
❌ No text at all — just a spinner   (screen reader users get nothing)
```

```dart
// Flutter — loading widget with label and semantic label for accessibility
class LoadingWithLabel extends StatelessWidget {
  const LoadingWithLabel({required this.label, super.key});
  final String label;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 16),
            Text(label, style: Theme.of(context).textTheme.bodyMedium),
          ],
        ),
      ),
    );
  }
}
```

### 7. Empty States

Empty states are not errors — they are opportunities to explain value and prompt action.

#### Empty State Structure

```
1. Illustration or icon (sets emotional tone)
2. Headline: what this screen is for (2-6 words)
3. Body: why it's empty and what the user can do (1 sentence max)
4. CTA button: the first action to populate this space
```

#### Empty State Copy — Common Patterns

| Screen | Headline | Body | CTA |
|---|---|---|---|
| Inbox | "No messages yet" | "Messages from your team will appear here." | — |
| Search results | "No results found" | "Try a different search term or adjust your filters." | "Clear filters" |
| Orders | "No orders yet" | "Your order history will appear here once you place your first order." | "Browse products" |
| Notifications | "No notifications" | "We'll let you know when something needs your attention." | — |
| Favorites | "No favorites yet" | "Tap the heart icon on any item to save it here." | "Browse items" |
| Tasks | "All caught up" | "You've completed all your tasks for today." | — |
| Error (data failed) | "We couldn't load your data" | "Check your connection and try again." | "Try again" |

#### Anti-Patterns

```
❌ "No data"                            → no context, no action
❌ "Nothing here"                        → dismissive tone
❌ "Empty"                               → meaningless
❌ "There are no items in this list"     → technically accurate, useless to the user
```

### 8. Confirmation Dialogs — Destructive Actions

Destructive actions require a different pattern than standard confirmations. The goal is to prevent accidental data loss without annoying the user for trivial actions.

#### Destructive Dialog Structure

```
1. Title: Start with a verb, name the specific resource
2. Body: Describe the consequence — permanent, reversible, or time-limited
3. Warning: "This action cannot be undone." (if truly irreversible)
4. Input confirmation: require typing the resource name for account/data deletion
5. Buttons: destructive action labeled explicitly + "Cancel"
```

#### Escalation Levels

| Risk | Pattern | Example |
|---|---|---|
| **Low** (undoable) | Standard confirm dialog | "Delete comment?" → "Delete" / "Cancel" |
| **Medium** (permanent, contained) | Explicit body + warning | "Delete project 'Q4 Report'? All tasks and files in this project will be permanently deleted." |
| **High** (account/data deletion) | Type-to-confirm + warning | "Delete your account? This permanently removes all your data. Type 'DELETE' to confirm." |
| **Critical** (financial/legal) | Multi-step + cooling-off period | Two confirmations + email verification + 24h delay |

```dart
// Flutter — destructive confirmation dialog
Future<bool> showDestructiveConfirmDialog(
  BuildContext context, {
  required String title,
  required String body,
  required String confirmLabel,
  String? warning,
  String? typeToConfirm,
}) async {
  final result = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) {
      final controller = typeToConfirm != null ? TextEditingController() : null;
      return AlertDialog(
        title: Text(title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(body),
            if (warning != null) ...[
              const SizedBox(height: 12),
              Text(warning, style: TextStyle(color: Theme.of(ctx).colorScheme.error, fontWeight: FontWeight.w600)),
            ],
            if (typeToConfirm != null) ...[
              const SizedBox(height: 16),
              Text('Type "$typeToConfirm" to confirm:', style: Theme.of(ctx).textTheme.bodySmall),
              const SizedBox(height: 8),
              TextField(controller: controller, decoration: InputDecoration(hintText: typeToConfirm)),
            ],
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () {
              if (typeToConfirm != null && controller!.text.trim() != typeToConfirm) return;
              Navigator.pop(ctx, true);
            },
            style: TextButton.styleFrom(foregroundColor: Theme.of(ctx).colorScheme.error),
            child: Text(confirmLabel),
          ),
        ],
      );
    },
  );
  return result ?? false;
}

// Usage
final confirmed = await showDestructiveConfirmDialog(
  context,
  title: 'Delete project',
  body: 'All tasks, files, and comments in "Q4 Report" will be permanently deleted.',
  warning: 'This action cannot be undone.',
  confirmLabel: 'Delete project',
);
```

### 9. Toast / Snackbar Messages

Toasts are transient, non-blocking messages. They must be scannable in under 2 seconds.

#### Toast Timing by Type

| Type | Duration | Can user dismiss? |
|---|---|---|
| Success | 3-4 seconds | Yes (swipe) |
| Info | 4-5 seconds | Yes |
| Warning | 5-6 seconds | No (requires attention) |
| Error | Until dismissed or 8 seconds | Yes |
| Undo-able action | 6-8 seconds | Yes (via Undo button) |

#### Toast Copy Examples

```
// Success
✅ "File uploaded"
✅ "Settings saved"
✅ "Invitation sent"

// Info
✅ "New features are available. Tap to see what's changed."
✅ "You've been added to Project Alpha"

// Warning
✅ "Your storage is almost full. Free up space to continue."
✅ "Session expires in 5 minutes"

// Error with action
✅ "Message failed to send"                [Try again]
✅ "Changes couldn't be saved"             [Retry]

// Undo pattern (non-destructive dismissal)
✅ "Item removed"                          [Undo]
✅ "Email archived"                        [Undo]
✅ "Task deleted"                          [Undo]
```

```dart
// Flutter — toast helper with undo support
void showUndoSnackBar(BuildContext context, String message, VoidCallback onUndo) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message),
      behavior: SnackBarBehavior.floating,
      duration: const Duration(seconds: 6),
      action: SnackBarAction(label: 'Undo', onPressed: () {
        onUndo();
        ScaffoldMessenger.of(context).hideCurrentSnackBar();
      }),
      dismissDirection: DismissDirection.horizontal,
    ));
}
```

### 10. Modal and Dialog Copy

Modals interrupt the user — use sparingly. When you must use one:

#### Modal Title Rules

- Start with a verb for action modals: "Delete item", "Share file", "Invite member"
- Use a noun phrase for information modals: "About this version", "Privacy notice"
- Never use "Alert", "Notice", "Warning" as a title — say what the alert is about

#### Modal Body Rules

- First sentence states what will happen
- Second sentence states consequences (if any)
- Never exceed 3 sentences in a modal body
- If more information is needed, link to a full page — not a scrollable modal

```dart
// Modal copy catalog
class ModalCopy {
  // Destructive
  static const deleteItemTitle = 'Delete item';
  static const deleteItemBody = '"{itemName}" will be permanently removed. This action cannot be undone.';

  // Session
  static const sessionExpiredTitle = 'Session expired';
  static const sessionExpiredBody = 'For your security, you\'ve been signed out due to inactivity. Sign in again to continue.';

  // Unsaved changes
  static const unsavedTitle = 'Discard changes?';
  static const unsavedBody = 'You have unsaved changes. If you leave now, your changes will be lost.';

  // Feature access
  static const upgradeTitle = 'Upgrade required';
  static const upgradeBody = 'This feature is available on the Pro plan. Upgrade to access advanced reporting and unlimited projects.';

  // Connection
  static const offlineTitle = 'You\'re offline';
  static const offlineBody = 'Some features may be unavailable until your connection is restored. Your data is saved locally.';
}
```

### 11. Onboarding Flow Text

Onboarding is not a manual — it's a first impression. Each screen must pass the "one-sentence test": the user understands the value in one sentence.

#### Onboarding Screen Structure

```
1. Illustration / animation (sets emotional tone, reduces cognitive load)
2. Headline: the benefit, not the feature (4-7 words)
3. Body: one sentence explaining the value (max 15 words)
4. Progress indicator (dots or "Step 2 of 4")
5. CTA: "Continue" (not "Next") or "Get started" on final screen
```

#### Before/After — Onboarding Copy

| Screen | ❌ Feature-focused | ✅ Benefit-focused |
|---|---|---|
| Dashboard | "View your dashboard with charts and KPIs" | "See how your business is doing at a glance" |
| Orders | "Manage orders with filters and sorting" | "Track every order from placement to delivery" |
| Notifications | "Receive push notifications" | "Never miss an important update" |
| Offline | "Your data is stored locally" | "Work without internet — syncs when you're back online" |

```ts
// React / React Native — onboarding screen data model
interface OnboardingSlide {
  illustration: string;      // Asset path
  headline: string;          // 4-7 words, benefit
  body: string;              // Max 15 words
}

const ONBOARDING_SLIDES: OnboardingSlide[] = [
  {
    illustration: 'onboarding_track',
    headline: 'Track every delivery in real time',
    body: 'Know exactly where each order is, from warehouse to doorstep.',
  },
  {
    illustration: 'onboarding_offline',
    headline: 'Works even without internet',
    body: 'Your data syncs automatically when you\'re back online.',
  },
  {
    illustration: 'onboarding_team',
    headline: 'Your whole team, connected',
    body: 'Sales, warehouse, and drivers — all in one place.',
  },
];
```

#### Permission Requests (Mobile)

Never ask for a permission without explaining why. Always handle denial gracefully.

```
✅ "GMP would like to access your location to show nearby deliveries."
   [Allow] [Not now]

✅ "Allow notifications to get updates when an order status changes."
   [Allow] [Maybe later]

❌ "This app needs location access."
❌ "Enable notifications." (no explanation)
```

### 12. Form Content Design

Form copy is the highest-impact UX writing because it directly causes or prevents errors.

#### Form Field Copy Checklist

1. **Label**: short, sentence case, no colon at end. Mark required fields.
2. **Placeholder**: show format/example, not a duplicate of the label.
3. **Helper text**: appears below the field. Use for constraints or format requirements.
4. **Error text**: replaces helper text on validation failure. Must be field-specific.

```
┌─────────────────────────────────────────────┐
│  Email address (required)                    │  ← Label
│  name@company.com                            │  ← Placeholder
│  We'll send your receipt to this address.    │  ← Helper text
│  ───────────────────────────────────────────  │
│  Enter a valid email address                 │  ← Error text (on validation fail)
└─────────────────────────────────────────────┘
```

#### Helper Text Patterns

```
✅ "We'll never share your email with anyone."
✅ "Must be at least 8 characters, including a number."
✅ "Use the address where you receive packages."
✅ "This will be visible to your team members."

❌ "Enter your email"          (repeats the label)
❌ "Required field"             (use the label "(required)" suffix instead)
❌ Long paragraphs              (max 2 lines of helper text)
```

#### Submit Button Copy

| Context | Button text |
|---|---|
| Creating | "Create account", "Add item", "Send invitation" |
| Saving / updating | "Save changes", "Update profile" |
| Logging in | "Sign in" |
| Registering | "Create account" |
| Search | "Search" (not "Submit") |
| Payment | "Pay \$24.99" (include the amount) |
| Multi-step final | "Complete setup", "Finish" |

```dart
// Flutter — form field with label, placeholder, helper, and error
class AppFormField extends StatelessWidget {
  final String label;
  final String placeholder;
  final String? helperText;
  final String? errorText;
  final bool required;
  // ... other TextFormField props

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('$label${required ? ' (required)' : ''}'),
        const SizedBox(height: 4),
        TextFormField(
          decoration: InputDecoration(
            hintText: placeholder,
            helperText: errorText == null ? helperText : null,
            errorText: errorText,
          ),
        ),
      ],
    );
  }
}
```

### 13. Notification and In-App Messaging

#### Push Notification Rules

- Title: 30-40 characters. Identify the source clearly.
- Body: 60-100 characters. State what changed and why the user should care.
- Action: what happens when tapped? Match the expectation the notification sets.

```
✅ Title: "Order #1428 delivered"
   Body: "Customer signed for delivery at 14:32. Tap to view details."

✅ Title: "New message from Carlos"
   Body: "Re: Q4 inventory — 'Can you confirm the stock numbers?'"

✅ Title: "Payment received"
   Body: "$1,240.00 from Clínica del Sol. Your balance has been updated."

❌ Title: "Update"                                 (too vague)
❌ Body: "Something happened in your account"        (no specificity)
❌ Body: "Click here to see what changed"            (don't say "click" on mobile)
```

#### In-App Notification Center

```
// Notification grouping
"Today"
  "Order #1428 delivered — 14:32"
  "Payment received: $1,240.00 — 11:15"

"Yesterday"
  "New message from Carlos — 18:42"
  "3 orders ready for delivery — 09:00"
```

#### Badge Copy

Badges convey state in 1-2 words. Never use badges for complex statuses.

```
✅ "New"        ✅ "3"          ✅ "Beta"
✅ "Active"     ✅ "Overdue"    ✅ "Urgent"

❌ "Awaiting customer response" (too long for a badge — use a status chip)
❌ Long status text that wraps
```

### 14. Spanish / English Localization in UI Strings

Localization is not word-for-word translation. Spanish strings average 20-30% longer than English equivalents. Always design for the longer string.

#### Structural Differences

| Concern | English | Spanish |
|---|---|---|
| Length | Shorter | ~20-30% longer |
| Formality | First name, "you" | "Tú" (informal) or "Usted" (formal) — choose one and stick to it |
| Gender | Neutral | Gendered nouns and adjectives — use gender-neutral rewrites when possible |
| Capitalization | Title Case for headings | Sentence case for headings (only first word capitalized) |
| Punctuation | No space before ?/! | ¿ / ¡ required, space before? (typographic convention varies) |

#### Translation Quality Checklist

```
❌ "Guardar los cambios"         (translated Save changes word-for-word — too long for a button)
✅ "Guardar cambios"              (natural, concise)

❌ "Su contraseña debe contener por lo menos 8 caracteres" (overly formal)
✅ "La contraseña debe tener al menos 8 caracteres"        (natural)

❌ "No se encontraron resultados para su búsqueda"          (passive, formal)
✅ "No encontramos resultados para esta búsqueda"           (active, natural)

❌ "Usted ha sido desconectado"                              (formal, passive)
✅ "Tu sesión expiró"                                        (concise, natural)
```

```dart
// Flutter — localization with ARB (Application Resource Bundle)
// intl_en.arb
{
  "saveChanges": "Save changes",
  "@saveChanges": { "description": "Button label for saving form changes" },
  "sessionExpiredTitle": "Session expired",
  "sessionExpiredBody": "You've been signed out due to inactivity. Sign in again.",
  "noResults": "No results found",
  "tryDifferentSearch": "Try a different search term or adjust your filters.",
  "clearFilters": "Clear filters",
  "deleteConfirmation": "Delete \"{itemName}\"?",
  "@deleteConfirmation": { "placeholders": { "itemName": { "example": "Q4 Report" } } },
  "cannotUndo": "This action cannot be undone."
}

// intl_es.arb
{
  "saveChanges": "Guardar cambios",
  "sessionExpiredTitle": "Sesión expirada",
  "sessionExpiredBody": "Cerramos tu sesión por inactividad. Vuelve a iniciar sesión.",
  "noResults": "Sin resultados",
  "tryDifferentSearch": "Prueba con otro término o ajusta los filtros.",
  "clearFilters": "Quitar filtros",
  "deleteConfirmation": "¿Eliminar \"{itemName}\"?",
  "cannotUndo": "Esta acción no se puede deshacer."
}
```

#### Voice Consistency Across Languages

| English (tú) | Spanish (tú) |
|---|---|
| "You're all caught up" | "Estás al día" |
| "We couldn't save your changes" | "No pudimos guardar los cambios" |
| "Check your email" | "Revisa tu correo" |
| "Something went wrong" | "Algo salió mal" |

### 15. Accessibility in Microcopy

Accessible microcopy means screen readers can convey the same information a sighted user gets visually.

#### Screen Reader Context

- **Semantic labels**: provide context that visual layout gives for free
- **`aria-label` / `Semantics`**: override visible text when it needs more context for screen readers
- **Status announcements**: use `aria-live` regions or `Semantics` with `liveRegion: true` for dynamic changes
- **Button labels**: screen readers should hear the action, not "button"

```dart
// Flutter — accessibility annotations
// Visible: "Delete" — Screen reader: "Delete project Q4 Report"
IconButton(
  icon: const Icon(Icons.delete),
  onPressed: () => deleteProject(project),
  tooltip: 'Delete project ${project.name}',
).withSemantics(label: 'Delete project ${project.name}');

// Visible: badge with number 3 — Screen reader: "3 unread messages"
Badge(
  child: const Icon(Icons.email),
  label: Text('3'),
).withSemantics(label: '3 unread messages');

// Loading state — screen reader announces what's loading
Semantics(
  label: 'Loading your orders',
  child: CircularProgressIndicator(),
);
```

```tsx
// React — ARIA annotations for microcopy
// Visible icon button — screen reader gets context
<button aria-label="Delete project Q4 Report" onClick={handleDelete}>
  <TrashIcon />
</button>

// Status message that's announced by screen readers
<div role="status" aria-live="polite">
  {hasError ? 'We couldn\'t load your data. Try again.' : 'Data loaded successfully.'}
</div>

// Empty state with heading hierarchy
<section aria-labelledby="empty-heading">
  <h2 id="empty-heading">No orders yet</h2>
  <p>Your order history will appear here once you place your first order.</p>
  <button aria-label="Browse products to place your first order">Browse products</button>
</section>
```

#### Accessibility Copy Checklist

- [ ] All icon-only buttons have `aria-label` or `Semantics.label`
- [ ] Form errors are linked to fields via `aria-describedby` or Flutter `Semantics` error
- [ ] Loading states announce what is loading, not just "busy"
- [ ] Success/error toasts use `aria-live="polite"` or `Semantics(announce: true)`
- [ ] Headings are in logical order (h1 → h2 → h3)
- [ ] Color is never the only way to convey information — pair with text or icons
- [ ] Error text, helper text, and labels are read in the correct order for screen readers

### 16. Privacy Policy and T&C Summaries

Full legal documents are required, but users need a one-glance summary before agreeing.

#### Layered Notice Pattern

```
Layer 1 — Bullet summary (shown inline, always visible, 3-5 bullets)
Layer 2 — Full text (collapsed, expandable or linked)

✅ "By creating an account, you agree to our Terms of Service and Privacy Policy."
✅ "We use your data to:
     • Process your orders and payments
     • Send order updates and delivery notifications
     • Improve our service
   We never sell your personal data."

❌ A wall of 5,000 words of legal text with a single "I agree" button
```

```dart
// Flutter — privacy summary widget
class PrivacyNotice extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('How we use your data', style: TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        const Text('• To process your orders and payments'),
        const Text('• To send order updates and delivery notifications'),
        const Text('• To improve our service'),
        const SizedBox(height: 8),
        const Text('We never sell your personal data to third parties.'),
        const SizedBox(height: 12),
        GestureDetector(
          onTap: () => launchUrl(Uri.parse('https://example.com/privacy')),
          child: const Text('Read the full privacy policy', style: TextStyle(decoration: TextDecoration.underline)),
        ),
      ],
    );
  }
}
```

---

## Verification Checklist

### Principles
- [ ] Every string is clear on first read — no jargon, no internal codes, no HTTP status codes exposed to users
- [ ] Every string is as short as possible without losing meaning
- [ ] Every error message includes a next step (or clear reason why there isn't one)
- [ ] The same verb is used for the same action across the entire app

### Error Messages
- [ ] No stack traces, file paths, or database error codes exposed in user-facing messages
- [ ] Auth errors never reveal whether the email or password was wrong (use "Incorrect email or password")
- [ ] Validation errors reference specific fields and state the constraint clearly
- [ ] Network errors distinguish between "no connection" and "server timeout"
- [ ] 5xx errors use consistent, calm language — never "Oops" or "Something broke"

### States
- [ ] Loading states include a descriptive label — never just a spinner
- [ ] Empty states follow the structure: illustration + headline + body + CTA
- [ ] Success toasts are brief (≤ 5 words) and dismissible
- [ ] Every screen has content for: loading, empty, error, and populated states

### Destructive Actions
- [ ] Destructive confirmations explicitly state the consequence in the body
- [ ] Irreversible actions include the phrase "This action cannot be undone"
- [ ] Account/data deletion requires the user to type a confirmation string
- [ ] The confirm button uses specific language ("Delete project", "Remove item") — never just "OK" or "Confirm"

### Localization
- [ ] Spanish strings are 20-30% longer than English — UI accommodates the longer text
- [ ] Tone register is consistent across languages (tú vs. usted decision made and applied everywhere)
- [ ] Gender-neutral language used where possible in Spanish
- [ ] No idioms or culturally-specific humor that won't translate

### Accessibility
- [ ] Icon-only buttons have `aria-label` or `Semantics.label`
- [ ] Form errors are programmatically linked to their fields
- [ ] Dynamic content changes (toasts, loading, errors) are announced with `aria-live` or `Semantics(announce:)`
- [ ] Color is never the only way to communicate state (error, success, required)
- [ ] Headings follow a logical hierarchy (h1 → h2 → h3)

### Forms
- [ ] Required fields are marked with "(required)" — not just an asterisk
- [ ] Placeholders show format/examples, not instructions that disappear on focus
- [ ] Helper text is used for constraints and format requirements — not redundant label repetition
- [ ] Submit buttons use action verbs that describe what happens next

### Privacy
- [ ] Privacy policy and terms include a human-readable summary (3-5 bullets)
- [ ] Consent checkboxes are not pre-checked
- [ ] Users can access the full policy text from the summary
