---
name: tailwind-styling
description: Tailwind CSS avanzado — design tokens, dark mode, variantes con cva(), plugins personalizados y optimización de bundle.
---

## Overview

This skill covers production-grade Tailwind CSS usage: extending the design system through `tailwind.config.ts`, building type-safe component variants with `cva()`, enabling dark mode with CSS variables, writing custom plugins, and keeping the bundle lean with correct content paths.

---

## When to Use

- Configuring a new project's design system in Tailwind
- Building reusable, variant-rich components (buttons, badges, inputs)
- Implementing dark mode with semantic color tokens
- Auditing an existing project for Tailwind anti-patterns

## When NOT to Use

- Replacing a mature design system already agreed with the design team without sign-off
- When CSS Modules or styled-components are the established pattern on the project

---

## Step-by-Step Process

### 1. Design Token Configuration

Extend — never replace — the default theme. Use semantic naming.

```ts
// tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "hsl(var(--brand-50) / <alpha-value>)",
          500: "hsl(var(--brand-500) / <alpha-value>)",
          900: "hsl(var(--brand-900) / <alpha-value>)",
        },
        surface: "hsl(var(--surface) / <alpha-value>)",
        "on-surface": "hsl(var(--on-surface) / <alpha-value>)",
      },
      spacing: {
        18: "4.5rem",
        22: "5.5rem",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      boxShadow: {
        card: "0 1px 3px 0 hsl(var(--on-surface) / 0.1), 0 1px 2px -1px hsl(var(--on-surface) / 0.1)",
      },
    },
  },
  plugins: [],
};
export default config;
```

### 2. Dark Mode with CSS Variables

Define tokens at the `:root` and `.dark` level — Tailwind's `dark:` variant then works automatically.

```css
/* globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --brand-50:  220 90% 96%;
    --brand-500: 220 80% 50%;
    --brand-900: 220 70% 20%;
    --surface:   0 0% 100%;
    --on-surface: 222 47% 11%;
  }
  .dark {
    --surface:    222 47% 11%;
    --on-surface: 210 40% 98%;
  }
}
```

Toggle dark mode in your root layout:
```tsx
// layout.tsx — toggle class on <html>
<html lang="en" className={isDark ? "dark" : ""}>
```

### 3. The `cn()` Utility

Always merge Tailwind classes through `cn()` to avoid conflicting utilities.

```ts
// lib/cn.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

### 4. Component Variants with `cva()`

```tsx
// components/button.tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:  "bg-brand-500 text-white hover:bg-brand-500/90",
        outline:  "border border-brand-500 bg-transparent text-brand-500 hover:bg-brand-50",
        ghost:    "bg-transparent hover:bg-brand-50 text-brand-500",
        danger:   "bg-red-600 text-white hover:bg-red-700",
      },
      size: {
        sm:  "h-8 px-3",
        md:  "h-10 px-4",
        lg:  "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  }
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
```

### 5. Responsive Design

Tailwind is mobile-first: unprefixed utilities apply to all sizes; prefixed ones override upward.

```tsx
// Responsive grid
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
  {items.map((item) => <Card key={item.id} {...item} />)}
</div>
```

Use `@tailwindcss/container-queries` for component-level responsiveness:
```tsx
// After: npm i @tailwindcss/container-queries
// tailwind.config.ts plugins: [require("@tailwindcss/container-queries")]
<div className="@container">
  <div className="flex-col @md:flex-row flex gap-4">…</div>
</div>
```

### 6. Custom Plugin

```ts
// tailwind.config.ts
import plugin from "tailwindcss/plugin";

const config: Config = {
  plugins: [
    plugin(({ addUtilities, addComponents, theme }) => {
      addUtilities({
        ".scrollbar-hidden": {
          "-ms-overflow-style": "none",
          "scrollbar-width": "none",
          "&::-webkit-scrollbar": { display: "none" },
        },
      });
      addComponents({
        ".card": {
          backgroundColor: "hsl(var(--surface))",
          borderRadius: theme("borderRadius.lg"),
          boxShadow: theme("boxShadow.card"),
          padding: theme("spacing.6"),
        },
      });
    }),
  ],
};
```

### 7. Performance — Avoiding Purge Issues

Never construct class names dynamically from string concatenation:
```ts
// BAD — Tailwind cannot statically analyze this
const cls = `bg-${color}-500`;

// GOOD — full class names in a lookup map
const colorMap: Record<string, string> = {
  red: "bg-red-500",
  blue: "bg-blue-500",
};
const cls = colorMap[color];
```

Ensure `content` paths in `tailwind.config.ts` cover every file that contains Tailwind classes, including libraries in `node_modules` if needed (use `safelist` sparingly for truly dynamic classes).

---

## Verification Checklist

- [ ] `tailwind.config.ts` uses `extend` — default theme not replaced
- [ ] All color tokens use CSS variables with `/ <alpha-value>` for opacity support
- [ ] Dark mode tokens defined in `:root` and `.dark` in `globals.css`
- [ ] `cn()` (clsx + tailwind-merge) used everywhere classes are composed
- [ ] Component variants implemented with `cva()` — no conditional string concatenation
- [ ] No dynamic class name construction from partial strings
- [ ] `content` array covers all source files
- [ ] Bundle analyzed — no unexpected classes retained
- [ ] Custom plugins documented with usage examples in Storybook/README
