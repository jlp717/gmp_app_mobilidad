---
name: tdd-workflow
description: TDD Red-Green-Refactor cycle — Arrange-Act-Assert, test doubles, async testing, TypeScript and Flutter examples.
---

# TDD Workflow — Red-Green-Refactor Professional Guide

## Overview

Test-Driven Development inverts the normal workflow: you write a failing test that specifies the exact behavior you want, then write the minimum code to make it pass, then clean up. The test suite becomes a living specification and a safety net for refactoring.

## When to Use

- Every new feature, bug fix, or behavioral change
- Designing the public API of a service or component before implementation
- Ensuring edge cases (null inputs, empty collections, error paths) are explicitly handled

## When NOT to Use

- Pure UI layout tweaks with no logic (use snapshot or visual regression tests instead)
- Exploratory/spike code that will be discarded — but write tests before promoting spike to production
- Third-party integration setup where behavior is fully delegated to the library

---

## Step-by-Step Process

### 1. Red Phase — Write a Failing Test First

Before touching implementation, write a test that precisely asserts the behavior. Run it and **confirm it fails for the right reason** (not a syntax error, not a missing import — the actual assertion must fail).

```ts
// __tests__/EmailService.test.ts  ← written BEFORE EmailService.ts exists
import { EmailService } from '../EmailService';
import { MockMailer } from '../__mocks__/MockMailer';

describe('EmailService.sendWelcome', () => {
  it('sends a welcome email to the new user', async () => {
    // Arrange
    const mailer = new MockMailer();
    const service = new EmailService(mailer);

    // Act
    await service.sendWelcome({ email: 'user@example.com', name: 'Alice' });

    // Assert
    expect(mailer.sentMessages).toHaveLength(1);
    expect(mailer.sentMessages[0]).toMatchObject({
      to: 'user@example.com',
      subject: 'Welcome to the app, Alice!',
    });
  });

  it('throws if email is empty', async () => {
    const service = new EmailService(new MockMailer());
    await expect(service.sendWelcome({ email: '', name: 'Bob' })).rejects.toThrow('Invalid email');
  });
});
```

Run: `npx jest EmailService` → **FAIL** (module not found). This is correct.

### 2. Green Phase — Write Minimum Code to Pass

Write only what is needed. No extras, no future-proofing.

```ts
// EmailService.ts
export interface Mailer {
  send(message: { to: string; subject: string; body: string }): Promise<void>;
}

export interface WelcomePayload {
  email: string;
  name: string;
}

export class EmailService {
  constructor(private readonly mailer: Mailer) {}

  async sendWelcome(payload: WelcomePayload): Promise<void> {
    if (!payload.email) throw new Error('Invalid email');
    await this.mailer.send({
      to: payload.email,
      subject: `Welcome to the app, ${payload.name}!`,
      body: `Hi ${payload.name}, welcome!`,
    });
  }
}
```

```ts
// __mocks__/MockMailer.ts
import { Mailer } from '../EmailService';

export class MockMailer implements Mailer {
  sentMessages: Array<{ to: string; subject: string; body: string }> = [];

  async send(message: { to: string; subject: string; body: string }): Promise<void> {
    this.sentMessages.push(message);
  }
}
```

Run: `npx jest EmailService` → **PASS**. Move on.

### 3. Refactor Phase — Improve Without Breaking

Clean up duplication, naming, structure. Tests must still pass after every change.

```ts
// Refactored: extract validation, use a template function
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export class EmailService {
  constructor(private readonly mailer: Mailer) {}

  async sendWelcome({ email, name }: WelcomePayload): Promise<void> {
    if (!isValidEmail(email)) throw new Error('Invalid email');
    await this.mailer.send(this.buildWelcomeMessage(email, name));
  }

  private buildWelcomeMessage(email: string, name: string) {
    return {
      to: email,
      subject: `Welcome to the app, ${name}!`,
      body: `Hi ${name}, thank you for joining us.`,
    };
  }
}
```

Run: `npx jest EmailService` → **PASS**. Refactor complete.

### 4. Test Anatomy — Arrange-Act-Assert

Every test has three clearly separated sections:

```ts
it('returns discounted price for premium users', () => {
  // Arrange — set up all preconditions and inputs
  const pricer = new PricingService();
  const product = { id: '1', basePrice: 100 };
  const user = { tier: 'premium' as const };

  // Act — call the single unit of behavior under test
  const result = pricer.calculatePrice(product, user);

  // Assert — verify the outcome, nothing else
  expect(result).toBe(80); // 20% discount
});
```

Rules:
- One behavior per test (one logical assertion, multiple `expect()` is fine)
- Test names describe behavior, not implementation: `"returns 80 for premium user"` not `"calls applyDiscount"`
- Never test implementation details (private methods, internal state)

### 5. Test Doubles

| Double | Purpose | When to use |
|---|---|---|
| **Stub** | Returns canned data | Replacing external APIs, DB queries in unit tests |
| **Mock** | Verifies calls were made | When the interaction itself is the behavior |
| **Spy** | Wraps real implementation, records calls | When you need real behavior + call verification |
| **Fake** | Working lightweight implementation | In-memory database, fake mailer (like MockMailer above) |

```ts
// Stub — doesn't care about calls, just returns data
const userRepoStub = { findById: jest.fn().mockResolvedValue({ id: '1', role: 'admin' }) };

// Mock — fails if not called correctly
const auditLogMock = { log: jest.fn() };
// After act:
expect(auditLogMock.log).toHaveBeenCalledWith({ action: 'LOGIN', userId: '1' });

// Spy — wraps real implementation
const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
```

### 6. TDD for Async Code, Error Paths, Side Effects

```ts
// Async error path
it('throws NotFoundException when user does not exist', async () => {
  const repo = { findById: jest.fn().mockResolvedValue(null) };
  const service = new UserService(repo);

  await expect(service.getUser('nonexistent')).rejects.toThrow(NotFoundException);
  await expect(service.getUser('nonexistent')).rejects.toMatchObject({ statusCode: 404 });
});

// Side effect: verify DB was NOT called on cache hit
it('returns cached user without hitting the database', async () => {
  const cache = new InMemoryCache();
  const db = { findById: jest.fn() };
  await cache.set('user:1', { id: '1', name: 'Alice' });

  const service = new UserService(db, cache);
  await service.getUser('1');

  expect(db.findById).not.toHaveBeenCalled();
});
```

### 7. Flutter TDD Example

```dart
// test/widget/counter_widget_test.dart — written first
void main() {
  testWidgets('displays 0 on initial render', (tester) async {
    // Arrange & Act
    await tester.pumpWidget(const MaterialApp(home: CounterWidget()));

    // Assert
    expect(find.text('0'), findsOneWidget);
    expect(find.text('Increment'), findsOneWidget);
  });

  testWidgets('increments count when button is tapped', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: CounterWidget()));

    await tester.tap(find.text('Increment'));
    await tester.pump();

    expect(find.text('1'), findsOneWidget);
  });
}

// lib/counter_widget.dart — written after tests fail
class CounterWidget extends StatefulWidget {
  const CounterWidget({super.key});
  @override
  State<CounterWidget> createState() => _CounterWidgetState();
}

class _CounterWidgetState extends State<CounterWidget> {
  int _count = 0;
  @override
  Widget build(BuildContext context) => Column(children: [
    Text('$_count'),
    ElevatedButton(onPressed: () => setState(() => _count++), child: const Text('Increment')),
  ]);
}
```

---

## Verification Checklist

- [ ] Test file written and failing BEFORE any implementation code
- [ ] Test failure is an assertion failure, not a compile/import error
- [ ] Each test follows Arrange-Act-Assert with visual separation
- [ ] Test name describes behavior from the user's perspective
- [ ] Minimum code written in Green phase — no speculative features
- [ ] Tests still pass after every refactor step
- [ ] No tests depend on implementation details (private methods, internal state)
- [ ] Async tests `await` assertions correctly; error paths tested with `rejects.toThrow`
- [ ] Test doubles are the correct type for the use case (stub vs mock vs fake)
- [ ] Coverage includes the happy path, error path, and at least one edge case
- [ ] Flutter widget tests use `tester.pump()` after state changes
