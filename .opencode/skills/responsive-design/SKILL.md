---
name: responsive-design
description: Diseño responsivo mobile-first — CSS Grid, Flexbox, breakpoints, tipografía fluida y touch targets.
---

## Overview

Responsive design is not about hiding content at different sizes — it is about progressively enhancing a solid mobile layout. This skill covers the full toolkit: mobile-first methodology, CSS Grid named areas, fluid typography with `clamp()`, accessible touch targets, and practical component patterns.

---

## When to Use

- Starting any new UI component or page layout
- Fixing layouts that break at specific viewport widths
- Auditing an existing product for mobile usability issues
- When implementing a design handed off in desktop-only frames

## When NOT to Use

- For purely data-entry desktop admin tools with no mobile requirement (but document this decision)
- When the product spec explicitly states "desktop only" with stakeholder sign-off

---

## Step-by-Step Process

### 1. Mobile-First Methodology

Write base styles for the smallest viewport first. Add breakpoint overrides only when the layout needs to change — not to "undo" mobile styles.

```css
/* BAD — desktop-first with undo */
.card { display: flex; flex-direction: row; }
@media (max-width: 768px) { .card { flex-direction: column; } }

/* GOOD — mobile-first, enhance up */
.card { display: flex; flex-direction: column; }
@media (min-width: 768px) { .card { flex-direction: row; } }
```

### 2. Breakpoints Reference

| Token | Min-width | Typical use |
|-------|-----------|-------------|
| (base) | 320px | Single-column, stacked |
| `sm` | 480px | Slightly wider phones, 2-col small grids |
| `md` | 768px | Tablets, side-by-side layouts |
| `lg` | 1024px | Laptop, main content + sidebar |
| `xl` | 1280px | Wide desktop layouts |
| `2xl` | 1536px | Ultra-wide, max-width containers |

Use breakpoints as the last resort. Content should drive breakpoints, not devices.

### 3. CSS Grid — Named Areas

```css
.page-layout {
  display: grid;
  grid-template-rows: auto 1fr auto;
  grid-template-areas:
    "header"
    "main"
    "footer";
  min-height: 100dvh;
}

@media (min-width: 1024px) {
  .page-layout {
    grid-template-columns: 240px 1fr;
    grid-template-areas:
      "header  header"
      "sidebar main"
      "footer  footer";
  }
}

header  { grid-area: header; }
.sidebar { grid-area: sidebar; }
main    { grid-area: main; }
footer  { grid-area: footer; }
```

**Auto-fill card grid:**
```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
  gap: 1.5rem;
}
```
`auto-fill` creates as many columns as fit. `min(280px, 100%)` prevents overflow on tiny viewports.

### 4. Flexbox for Reflow

```tsx
// Navigation that wraps gracefully
<nav className="flex flex-wrap items-center gap-2 px-4 py-2">
  {navItems.map((item) => (
    <a key={item.href} href={item.href} className="whitespace-nowrap px-3 py-1.5 rounded">
      {item.label}
    </a>
  ))}
</nav>
```

Use `order` to visually reorder elements without changing DOM order (preserves accessibility tab order):
```css
@media (min-width: 768px) {
  .cta-button { order: -1; } /* moves visually first on desktop */
}
```

### 5. Responsive Images

```tsx
// next/image — always specify sizes for performance
<Image
  src="/hero.jpg"
  alt="Product screenshot"
  width={1200}
  height={630}
  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 800px"
  priority
  className="w-full h-auto object-cover"
/>
```

For plain `<img>` with `srcset`:
```html
<img
  src="image-800.jpg"
  srcset="image-400.jpg 400w, image-800.jpg 800w, image-1200.jpg 1200w"
  sizes="(max-width: 600px) 100vw, 50vw"
  alt="Descriptive alt text"
  style="aspect-ratio: 16/9; object-fit: cover; width: 100%;"
/>
```

### 6. Fluid Typography with `clamp()`

```css
:root {
  --text-sm:   clamp(0.75rem, 0.7rem + 0.25vw, 0.875rem);
  --text-base: clamp(1rem,    0.9rem + 0.5vw,  1.125rem);
  --text-lg:   clamp(1.125rem, 1rem + 0.625vw, 1.375rem);
  --text-xl:   clamp(1.25rem,  1rem + 1.25vw,  1.75rem);
  --text-2xl:  clamp(1.5rem,   1rem + 2.5vw,   2.25rem);
  --text-hero: clamp(2rem,     1rem + 5vw,     4rem);
}
```

`clamp(min, preferred, max)` — the preferred value scales with viewport width. Never set font-size below 16px on body text.

### 7. Touch Targets

Every tappable element must be at least **44×44 px** (WCAG 2.5.5). Use padding to increase touch area without changing visual size:

```tsx
// Small icon button with adequate touch area
<button className="relative p-3 -m-1" aria-label="Delete item">
  <TrashIcon className="h-5 w-5" />
</button>
```

Space interactive elements at least **8px apart** to prevent mis-taps.

### 8. Responsive Navigation Pattern

```tsx
function Navigation() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 bg-surface border-b">
      <div className="mx-auto max-w-7xl px-4 flex items-center justify-between h-16">
        <Logo />
        {/* Mobile hamburger — hidden on md+ */}
        <button
          className="md:hidden p-2"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <XIcon /> : <MenuIcon />}
        </button>
        {/* Desktop nav — hidden below md */}
        <nav className="hidden md:flex items-center gap-6">
          <NavLinks />
        </nav>
      </div>
      {/* Mobile drawer */}
      {open && (
        <nav className="md:hidden border-t bg-surface px-4 py-4 flex flex-col gap-2">
          <NavLinks onClick={() => setOpen(false)} />
        </nav>
      )}
    </header>
  );
}
```

---

## Verification Checklist

- [ ] Base styles are mobile-first — no desktop-first overrides undone at mobile
- [ ] No horizontal scroll on 320px viewport (test in DevTools)
- [ ] Card grids use `auto-fill minmax` — no fixed column counts below `md`
- [ ] All `<img>` / `<Image>` have `sizes` attribute and explicit `aspect-ratio`
- [ ] Body font-size ≥ 16px; fluid scale uses `clamp()`
- [ ] All interactive elements are ≥ 44×44px touch target
- [ ] Navigation is usable and keyboard-accessible on mobile viewport
- [ ] Layout tested at 320px, 375px, 768px, 1024px, 1440px
- [ ] `dvh` used instead of `vh` for full-height mobile layouts (avoids browser chrome overlap)
