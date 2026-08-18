---
name: docs-sync
description: Mantener la documentación sincronizada con el código — TSDoc, README, CHANGELOG, OpenAPI y detección de drift en CI.
---

## Overview

Documentation that lies is worse than no documentation — it misleads. This skill establishes the discipline of keeping docs co-located with code, automatically generated where possible, and drift-detected in CI. The rule: if you change public behaviour, you change the docs in the same commit.

---

## When to Use

- When modifying any public API, exported function, or CLI interface
- After every release — CHANGELOG must be updated
- When adding a new feature that changes setup or usage (README update)
- When setting up a new project's documentation pipeline

## When NOT to Use

- For internal implementation details that change every commit — document the intent (why), not the mechanism (what)
- For obvious code where the name and types are self-documenting

---

## Step-by-Step Process

### 1. The Co-location Principle

Documentation lives in the same repository as the code it describes, in the same directory when possible:

```
src/
  features/
    payments/
      payment-service.ts        ← implementation
      payment-service.test.ts   ← tests
      README.md                 ← feature-level docs (optional for complex features)
docs/
  api/
    openapi.yaml               ← API contract (source of truth)
CHANGELOG.md                   ← project-level change history
README.md                      ← project overview + quickstart
```

Never maintain a separate docs repository that can drift out of sync.

### 2. TSDoc — When to Write, When to Skip

Write TSDoc on:
- Every exported function, class, and type
- Non-obvious parameters (anything that isn't obvious from the type)
- Functions with important side effects, throws, or async behaviour

Skip TSDoc on:
- Private/internal helpers that change frequently
- Re-exports with no additional behaviour
- Getters/setters where the property name is self-explanatory

```ts
/**
 * Processes a payment and returns a confirmed transaction.
 *
 * @param amount - Amount in the smallest currency unit (e.g., cents for USD).
 * @param currency - ISO 4217 currency code (e.g., "USD", "EUR").
 * @param customerId - Stripe customer ID — must already exist in Stripe.
 * @returns Confirmed transaction with Stripe payment intent ID.
 * @throws {PaymentDeclinedError} When the card is declined.
 * @throws {InvalidCurrencyError} When currency is not supported.
 *
 * @example
 * ```ts
 * const tx = await processPayment(1999, "USD", "cus_abc123");
 * console.log(tx.intentId); // pi_xxx
 * ```
 */
export async function processPayment(
  amount: number,
  currency: string,
  customerId: string
): Promise<Transaction> {
  // ...
}
```

### 3. README Maintenance Rules

Update `README.md` in the same commit as any change to:
- Installation / setup steps
- Environment variables (add/remove/rename)
- CLI commands or scripts
- Public API (function signatures, options objects)
- Breaking changes in behaviour

README structure for a library/service:
```markdown
# Project Name

One-sentence description.

## Prerequisites
- Node.js 20+
- pnpm 9+

## Installation
\`\`\`bash
pnpm install my-package
\`\`\`

## Usage
\`\`\`ts
import { processPayment } from "my-package";
const tx = await processPayment(1999, "USD", "cus_abc123");
\`\`\`

## Configuration
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| STRIPE_SECRET_KEY | ✅ | — | Stripe secret key |

## API Reference
See [docs/api](./docs/api) or the auto-generated TypeDoc output.

## Contributing
See [CONTRIBUTING.md](./CONTRIBUTING.md).
```

### 4. CHANGELOG with Conventional Commits

Use `release-please` (Google) or `standard-version` to auto-generate CHANGELOGs from commit history.

**Manual CHANGELOG entry format (Keep a Changelog standard):**
```markdown
## [2.3.0] — 2026-05-02

### Added
- Real-time ticket assignment notifications via polling (#312)
- `NotificationBell` component with unread badge count

### Fixed
- Assignment dropdown not closing after selection on Safari (#318)

### Changed
- `processPayment` now throws `PaymentDeclinedError` instead of returning null (#305)

### Removed
- Deprecated `createCharge()` function — use `processPayment()` instead

## [2.2.1] — 2026-04-15
...
```

**GitHub Action to auto-generate CHANGELOG:**
```yaml
# .github/workflows/release-please.yml
name: Release Please
on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: google-github-actions/release-please-action@v4
        with:
          release-type: node
          package-name: my-package
          changelog-types: |
            [
              {"type":"feat","section":"Features","hidden":false},
              {"type":"fix","section":"Bug Fixes","hidden":false},
              {"type":"perf","section":"Performance","hidden":false},
              {"type":"revert","section":"Reverts","hidden":false},
              {"type":"chore","section":"Miscellaneous","hidden":true}
            ]
```

### 5. OpenAPI as Source of Truth

Generate the OpenAPI spec from code — never maintain it by hand.

**Option A — tsoa (class-based):**
```ts
// controllers/payment.controller.ts
import { Controller, Post, Body, Route, Tags, SuccessResponse } from "tsoa";

@Route("payments")
@Tags("Payments")
export class PaymentController extends Controller {
  /**
   * Process a payment for a customer.
   */
  @Post()
  @SuccessResponse(201, "Created")
  async processPayment(@Body() body: ProcessPaymentRequest): Promise<Transaction> {
    // ...
  }
}
```

```bash
npx tsoa spec-and-routes  # generates openapi.json + Express routes
```

**Option B — zod-to-openapi:**
```ts
import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
extendZodWithOpenApi(z);

const TransactionSchema = z.object({
  id: z.string().openapi({ example: "tx_abc123" }),
  amount: z.number().int().positive().openapi({ description: "Amount in cents" }),
}).openapi("Transaction");
```

### 6. Drift Detection in CI

```yaml
# .github/workflows/docs-check.yml
name: Docs Check
on: [pull_request]

jobs:
  lint-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Lint markdown
        run: npx markdownlint-cli "**/*.md" --ignore node_modules

      - name: Verify examples compile
        run: |
          # Extract TypeScript examples from README and compile them
          npx ts-node --transpile-only docs/examples/*.ts

      - name: Check OpenAPI spec is up to date
        run: |
          npx tsoa spec
          git diff --exit-code openapi.json || (echo "openapi.json is out of date — run 'npx tsoa spec'" && exit 1)

      - name: Verify CHANGELOG has entry for this version
        run: |
          VERSION=$(node -p "require('./package.json').version")
          grep -q "## \[$VERSION\]" CHANGELOG.md || (echo "CHANGELOG.md missing entry for v$VERSION" && exit 1)
```

### 7. What NOT to Document

- **Implementation details:** internal algorithms, SQL query internals, private helper functions — these change too frequently and are best read from the code
- **Obvious code:** `getUserById(id)` does not need a doc comment
- **Temporary workarounds** in docs — put them in code comments with a TODO and ticket reference, not in README

---

## Verification Checklist

- [ ] Every exported function has TSDoc with `@param`, `@returns`, `@throws`, and `@example`
- [ ] README updated in the same commit as any public API change
- [ ] README usage examples are valid — they compile and run
- [ ] CHANGELOG has an entry for the current version following Keep a Changelog format
- [ ] OpenAPI spec generated from code — no hand-edited `openapi.yaml`
- [ ] `markdownlint` passes on all `.md` files
- [ ] CI checks that `openapi.json` matches generated output
- [ ] CI verifies CHANGELOG entry exists for current `package.json` version
- [ ] No documentation in a separate repository that can drift from this codebase
- [ ] Breaking changes documented in both CHANGELOG and migration guide
