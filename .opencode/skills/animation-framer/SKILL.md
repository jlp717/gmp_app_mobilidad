---
name: animation-framer
description: Framer Motion animations in React. Variants, AnimatePresence, layout animations, shared element transitions, performance best practices.
---

# Framer Motion — Professional Animation Guide

## Overview

Framer Motion is the standard animation library for React. It declaratively drives CSS transforms, opacity, and layout via a physics-based spring engine. All animations run on the compositor thread (GPU) when limited to `transform` and `opacity`, keeping the main thread free.

## When to Use

- Page/route transitions, modal enter/exit, list stagger effects
- Shared element transitions between routes (e.g. card → detail)
- Gesture-driven UI: drag, whileHover, whileTap
- Any animation that must respect `prefers-reduced-motion`

## When NOT to Use

- Simple CSS hover states — plain Tailwind `transition` is cheaper
- Animations on hundreds of DOM nodes simultaneously without `LayoutGroup` — prefer CSS `@keyframes`
- When bundle size is critical and the animation is trivial (Framer Motion is ~45 kB gzipped)

---

## Step-by-Step Process

### 1. Install

```bash
npm install framer-motion
```

### 2. Variants — Define Reusable Animation States

Variants centralize animation logic and enable parent→child orchestration via `staggerChildren`.

```tsx
// variants.ts
import { Variants } from 'framer-motion';

export const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
  exit: { opacity: 0, y: -8 },
};
```

```tsx
// StaggeredList.tsx
import { motion } from 'framer-motion';
import { containerVariants, itemVariants } from './variants';

export function StaggeredList({ items }: { items: string[] }) {
  return (
    <motion.ul variants={containerVariants} initial="hidden" animate="visible" exit="exit">
      {items.map((item) => (
        <motion.li key={item} variants={itemVariants}>
          {item}
        </motion.li>
      ))}
    </motion.ul>
  );
}
```

> Children automatically inherit `initial`/`animate`/`exit` from the parent — no need to repeat them.

### 3. AnimatePresence — Exit Animations & Conditional Rendering

```tsx
// Modal.tsx
import { AnimatePresence, motion } from 'framer-motion';

const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const panelVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95, y: 12 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 400, damping: 30 } },
  exit: { opacity: 0, scale: 0.95, y: 12, transition: { duration: 0.15 } },
};

export function Modal({ isOpen, onClose, children }: ModalProps) {
  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <motion.div
          key="backdrop"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          className="fixed inset-0 bg-black/50"
          onClick={onClose}
        >
          <motion.div
            key="panel"
            variants={panelVariants}
            className="modal-panel"
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

**`mode="wait"`** — outgoing element finishes exit before incoming element starts. Use for page transitions.  
**`mode="popLayout"`** — siblings reflow immediately; good for list remove animations.

### 4. Page Transitions

```tsx
// app/layout.tsx (Next.js App Router — client wrapper)
'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { usePathname } from 'next/navigation';

const pageVariants: Variants = {
  hidden: { opacity: 0, x: -16 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.25 } },
  exit: { opacity: 0, x: 16, transition: { duration: 0.2 } },
};

export function PageTransitionWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait">
      <motion.div key={pathname} variants={pageVariants} initial="hidden" animate="visible" exit="exit">
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
```

### 5. Layout Animations & Shared Element Transitions

`layoutId` teleports a component visually between two render locations using FLIP.

```tsx
// ProductCard → ProductDetail shared image
// In list:
<motion.img layoutId={`product-image-${id}`} src={src} className="card-img" />

// In detail page (same layoutId):
<motion.img layoutId={`product-image-${id}`} src={src} className="detail-img" />
```

Wrap both in `<LayoutGroup>` if they live in separate component trees:

```tsx
import { LayoutGroup } from 'framer-motion';
<LayoutGroup>
  <CardList />
  <DetailPanel />
</LayoutGroup>
```

Use `layout` prop for self-contained reflow animations (e.g. accordion expand):

```tsx
<motion.div layout className="accordion-body">
  {isOpen && <p>{content}</p>}
</motion.div>
```

### 6. Hooks — useAnimation, useInView, whileHover/whileTap

```tsx
import { motion, useAnimation, useInView } from 'framer-motion';
import { useEffect, useRef } from 'react';

export function RevealOnScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-80px' });
  const controls = useAnimation();

  useEffect(() => {
    if (isInView) controls.start('visible');
  }, [isInView, controls]);

  return (
    <motion.div
      ref={ref}
      variants={{ hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0 } }}
      initial="hidden"
      animate={controls}
      transition={{ duration: 0.4 }}
    >
      {children}
    </motion.div>
  );
}

// Gesture animations
<motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }} transition={{ type: 'spring', stiffness: 400 }}>
  Click me
</motion.button>
```

### 7. Performance Rules

| Rule | Why |
|---|---|
| Animate only `transform` (x, y, scale, rotate) and `opacity` | These skip layout and paint — GPU only |
| Avoid animating `width`, `height`, `top`, `left` | Triggers layout recalculation every frame |
| Use `layout` prop instead of animating dimensions | FLIP technique — still transform under the hood |
| Add `will-change: transform` via `style` sparingly | Promotes element to its own compositor layer |
| Use `useReducedMotion()` hook | Respect accessibility preferences |

```tsx
import { useReducedMotion } from 'framer-motion';

export function AnimatedCard() {
  const reduce = useReducedMotion();
  return (
    <motion.div
      animate={{ y: reduce ? 0 : -8 }}
      transition={{ type: 'spring' }}
    />
  );
}
```

---

## Verification Checklist

- [ ] All `motion.*` elements have explicit `initial` (or inherit from parent variants)
- [ ] `AnimatePresence` wraps every conditionally rendered `motion.*` element
- [ ] Each child inside `AnimatePresence` has a stable, unique `key` prop
- [ ] Shared element transitions use matching `layoutId` strings across both locations
- [ ] Animations only target `opacity`, `x`, `y`, `scale`, `rotate` — not layout properties
- [ ] `useReducedMotion()` disables or reduces motion for accessibility
- [ ] `mode="wait"` used for page transitions to prevent overlap
- [ ] No inline `animate={{ ... }}` objects recreated on every render — use `variants` or stable references
- [ ] `LayoutGroup` added when `layoutId` elements live in different subtrees
- [ ] Tested on low-end device: no dropped frames in Chrome DevTools Performance tab
