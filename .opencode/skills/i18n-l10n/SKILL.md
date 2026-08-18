---
name: i18n-l10n
description: Internacionalización con next-intl (App Router) y react-i18next — ICU messages, RTL, cambio de idioma y sincronización de traducciones.
---

## Overview

Internationalisation (i18n) separates user-facing strings from code. Localisation (l10n) adapts those strings — including dates, numbers, plurals, and layout direction — to each locale. This skill covers the full pipeline for both next-intl (Next.js 14 App Router) and react-i18next (any React app).

---

## When to Use

- Building a product that will be released in more than one language
- Adding a new language to an existing product
- Fixing incorrect plurals, date formats, or RTL layout issues
- Setting up the i18n infrastructure for a greenfield project

## When NOT to Use

- For internal tools with a single-language audience and no future internationalisation plan (hardcode and document the decision)

---

## Step-by-Step Process

### 1. next-intl — App Router Setup

```
npm install next-intl
```

**Directory structure:**
```
messages/
  en.json
  es.json
  ar.json
src/
  i18n.ts
  middleware.ts
  app/
    [locale]/
      layout.tsx
      page.tsx
```

**`middleware.ts` — locale detection:**
```ts
import createMiddleware from "next-intl/middleware";

export default createMiddleware({
  locales: ["en", "es", "ar"],
  defaultLocale: "en",
  localePrefix: "always", // /en/about, /es/about
});

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
```

**`i18n.ts` — request locale:**
```ts
import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async ({ locale }) => ({
  messages: (await import(`../messages/${locale}.json`)).default,
}));
```

**`app/[locale]/layout.tsx`:**
```tsx
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getLocale } from "next-intl/server";
import { notFound } from "next/navigation";

const locales = ["en", "es", "ar"];

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  if (!locales.includes(locale)) notFound();
  const messages = await getMessages();
  const isRtl = locale === "ar";

  return (
    <html lang={locale} dir={isRtl ? "rtl" : "ltr"}>
      <body>
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

**Using translations in a Server Component:**
```tsx
import { useTranslations } from "next-intl";

export default function HomePage() {
  const t = useTranslations("home");
  return <h1>{t("hero.title")}</h1>;
}
```

### 2. ICU Message Format

ICU handles plurals, selects, and interpolation in a single message string.

```json
// messages/en.json
{
  "home": {
    "hero": {
      "title": "Welcome back, {name}!"
    },
    "items": "{count, plural, =0 {No items} one {# item} other {# items}}",
    "lastSeen": "Last seen {date, date, medium}",
    "role": "{role, select, admin {Administrator} editor {Editor} other {Member}}"
  }
}
```

```tsx
// Usage
t("items", { count: 3 })        // → "3 items"
t("lastSeen", { date: new Date() }) // → "Last seen May 2, 2026"
t("role", { role: "admin" })    // → "Administrator"
```

### 3. Date and Number Formatting

```tsx
import { useFormatter } from "next-intl";

function PriceTag({ amount }: { amount: number }) {
  const format = useFormatter();
  return (
    <span>
      {format.number(amount, { style: "currency", currency: "USD" })}
    </span>
  );
}

function EventDate({ date }: { date: Date }) {
  const format = useFormatter();
  return <time>{format.dateTime(date, { dateStyle: "long" })}</time>;
}
```

Output adapts automatically to the active locale: `$1,234.56` in `en`, `1.234,56 $` in `de`.

### 4. react-i18next Setup

```ts
// lib/i18n.ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: { greeting: "Hello, {{name}}!" } },
      es: { common: { greeting: "¡Hola, {{name}}!" } },
    },
    fallbackLng: "en",
    defaultNS: "common",
    interpolation: { escapeValue: false }, // React already escapes
  });

export default i18n;
```

**Trans component for JSX interpolation:**
```tsx
import { Trans } from "react-i18next";
// messages: { "terms": "Read our <link>Privacy Policy</link>" }
<Trans
  i18nKey="terms"
  components={{ link: <a href="/privacy" className="underline" /> }}
/>
```

### 5. RTL Support

Use CSS logical properties — they flip automatically with `dir="rtl"`:

```css
/* BAD — physical properties break RTL */
.card { margin-left: 1rem; padding-right: 1.5rem; }

/* GOOD — logical properties adapt */
.card { margin-inline-start: 1rem; padding-inline-end: 1.5rem; }
```

Tailwind supports logical properties:
```tsx
<div className="ms-4 pe-6">  {/* margin-inline-start, padding-inline-end */}
```

### 6. Language Switcher with Locale Persistence

```tsx
// components/locale-switcher.tsx (next-intl)
"use client";
import { useRouter, usePathname } from "next-intl/client";
import { useLocale } from "next-intl";

const locales = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "ar", label: "العربية" },
];

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <select
      value={locale}
      onChange={(e) => router.replace(pathname, { locale: e.target.value })}
      aria-label="Select language"
    >
      {locales.map(({ code, label }) => (
        <option key={code} value={code}>{label}</option>
      ))}
    </select>
  );
}
```

Add `hreflang` tags to `<head>` for SEO:
```tsx
// app/[locale]/layout.tsx head
<link rel="alternate" hrefLang="en" href="https://example.com/en" />
<link rel="alternate" hrefLang="es" href="https://example.com/es" />
<link rel="alternate" hrefLang="x-default" href="https://example.com/en" />
```

### 7. Extract and Sync Translations

```bash
# Extract keys from source with i18next-scanner
npx i18next-scanner --config i18next-scanner.config.js

# i18next-scanner.config.js
module.exports = {
  input: ["src/**/*.{ts,tsx}"],
  output: "./messages/$LOCALE.json",
  options: { defaultLng: "en", lngs: ["en", "es", "ar"] },
};
```

Missing keys fall back to `defaultLocale`. Log missing keys in development:
```ts
i18n.init({ saveMissing: true, missingKeyHandler: (lng, ns, key) => console.warn(`Missing i18n key: ${key}`) });
```

---

## Verification Checklist

- [ ] `middleware.ts` handles locale detection and redirects correctly
- [ ] All locales render correct `lang` and `dir` attributes on `<html>`
- [ ] ICU plural forms tested for 0, 1, and many values in every locale
- [ ] Dates and currencies use `useFormatter` — no hardcoded locale strings
- [ ] All CSS uses logical properties (`inline-start/end`, `block-start/end`)
- [ ] RTL layout verified visually in Arabic locale
- [ ] Language switcher persists choice across navigation
- [ ] `hreflang` alternate links in `<head>` for all supported locales
- [ ] i18next-scanner run — no missing or unused keys
- [ ] Fallback to `defaultLocale` works for missing translations
