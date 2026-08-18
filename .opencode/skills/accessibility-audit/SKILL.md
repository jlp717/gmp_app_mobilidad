---
name: accessibility-audit
description: Auditoría de accesibilidad WCAG 2.1 AA. Cubre los cuatro principios POUR, herramientas de análisis y patrones de código accesibles.
---

## Overview

WCAG 2.1 AA is the legal and ethical baseline for web accessibility. This skill guides a complete audit across the four POUR principles — Perceivable, Operable, Understandable, Robust — using automated tools, manual keyboard testing, and screen reader verification.

---

## When to Use

- Before every production release of a UI feature
- When a new component library or design system is introduced
- After a major refactor of navigation, forms, or modal flows
- When a compliance review (ADA, EAA, EN 301 549) is required

## When NOT to Use

- As a substitute for involving disabled users in usability testing
- To rubber-stamp a broken design — fix the design first, then audit

---

## Step-by-Step Process

### 1. Perceivable

**Images:** Every `<img>` must have `alt`. Decorative images get `alt=""`.
```html
<img src="chart.png" alt="Revenue grew 42% YoY from Q1 2023 to Q1 2024" />
<img src="divider.svg" alt="" role="presentation" />
```

**Color contrast:** Normal text ≥ 4.5:1, large text (18pt / 14pt bold) ≥ 3:1. Use the browser DevTools eyedropper + WebAIM Contrast Checker. Never convey meaning by color alone — pair with an icon or text label.

**Captions / transcripts:** All `<video>` elements need `<track kind="captions">`. Audio-only content needs a text transcript.

### 2. Operable

**Skip link** — first focusable element on every page:
```html
<a href="#main-content" class="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:text-black">
  Skip to main content
</a>
<main id="main-content" tabindex="-1">…</main>
```

**Keyboard navigation:** Tab through every interactive element. Verify:
- Tab order matches visual reading order
- Focus indicator is visible (outline ≥ 2px, offset ≥ 2px, contrast ≥ 3:1)
- No keyboard traps — pressing Escape or Tab always escapes a widget

**Timing:** Any auto-updating content must be pausable (WCAG 2.2.2).

### 3. Understandable

**Form labels:** Every input has an associated `<label>` or `aria-label`.
```tsx
// Accessible form with inline error messaging
function EmailField({ error }: { error?: string }) {
  const id = "email";
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id}>Email address</label>
      <input
        id={id}
        type="email"
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? "true" : undefined}
      />
      {error && (
        <p id={errorId} role="alert" className="text-red-600 text-sm mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
```

**Error identification:** Error messages must identify the field AND describe how to fix it. "Required" is insufficient. Use "Email address is required — enter a valid address like name@example.com".

**Consistent navigation:** Site-wide nav appears in the same order on every page. Page `<title>` is unique and descriptive.

### 4. Robust

**Valid HTML:** Run the W3C Validator. Fix all errors — invalid nesting breaks ARIA.

**ARIA rules:**
- Do not add ARIA roles to native elements that already have semantics (`<button role="button">` is redundant, `<div role="button">` requires `tabindex="0"` AND keyboard handlers)
- All ARIA `id` references (`aria-labelledby`, `aria-describedby`, `aria-controls`) must point to existing elements
- Interactive ARIA widgets must implement the full keyboard pattern from the [APG](https://www.w3.org/WAI/ARIA/apg/)

**Accessible modal dialog:**
```tsx
function Modal({ open, onClose, title, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="dialog-title"
      aria-modal="true"
      onClose={onClose}
      className="rounded-lg p-6 max-w-lg w-full backdrop:bg-black/50"
    >
      <h2 id="dialog-title" className="text-xl font-semibold">{title}</h2>
      <div>{children}</div>
      <button onClick={onClose} aria-label="Close dialog">✕</button>
    </dialog>
  );
}
```
Using native `<dialog>` handles focus trapping and `aria-modal` automatically.

### 5. Automated Tools

```bash
# axe-core via CLI
npx axe-cli https://localhost:3000 --tags wcag2aa

# Lighthouse accessibility (CI)
npx lighthouse https://localhost:3000 --only-categories=accessibility --output=json | jq '.categories.accessibility.score'
```

Run axe in Jest/Vitest:
```ts
import { axe } from "jest-axe";
it("has no accessibility violations", async () => {
  const { container } = render(<MyComponent />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

### 6. Screen Reader Testing

| Tool | Platform | Shortcut |
|------|----------|----------|
| NVDA + Firefox | Windows | Caps Lock = NVDA key |
| VoiceOver + Safari | macOS/iOS | Cmd+F5 |
| TalkBack | Android | Triple-tap power |

Test: landmark navigation, form fill, modal open/close, error announcement.

---

## Verification Checklist

- [ ] All images have meaningful `alt` text (decorative use `alt=""`)
- [ ] Color contrast passes 4.5:1 (normal) and 3:1 (large text)
- [ ] Information is never conveyed by color alone
- [ ] Skip-to-content link is first focusable element
- [ ] Full keyboard navigation with visible focus indicators
- [ ] No keyboard traps exist
- [ ] All form inputs have associated labels
- [ ] Error messages identify field and describe correction
- [ ] All `<video>` elements have captions
- [ ] ARIA roles have required keyboard interactions
- [ ] All ARIA ID references resolve to real DOM elements
- [ ] `axe-cli` reports zero violations for `wcag2aa`
- [ ] Lighthouse Accessibility score ≥ 90
- [ ] Manual screen reader walkthrough completed on main user journey
