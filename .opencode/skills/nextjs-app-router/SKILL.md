---
name: nextjs-app-router
description: Next.js 14 App Router patterns — file conventions, Server/Client Components, data fetching, route handlers, middleware, server actions, metadata. Use when building or debugging Next.js 14 App Router features.
---

# Next.js 14 App Router — Professional Guide

## Overview
Next.js 14 App Router uses a file-system-based routing model inside the `app/` directory. Every folder can expose special files (`page.tsx`, `layout.tsx`, etc.) that compose the UI tree. Server Components are the default — opt into the client only when necessary.

---

## When to Use
- Building new routes, layouts, or API endpoints in a Next.js 14 project
- Deciding between Server Component and Client Component
- Implementing data fetching with caching, ISR, or SSG
- Writing server actions for form mutations
- Configuring middleware for auth guards or locale detection

## When NOT to Use
- Do NOT apply these patterns to Pages Router (`pages/`) projects
- Do NOT touch `backend/`, `tokens.css`, or root `layout.tsx` in **granja_mari_pepa**
- Do NOT reach for `'use client'` by default — keep components server-side unless you need interactivity or browser APIs

---

## File Conventions

| File | Purpose |
|---|---|
| `page.tsx` | Unique UI for a route segment, makes route publicly accessible |
| `layout.tsx` | Shared UI wrapping children; persists across navigations |
| `loading.tsx` | Suspense fallback shown while the segment streams |
| `error.tsx` | Error boundary for the segment (`'use client'` required) |
| `not-found.tsx` | Rendered when `notFound()` is called |
| `route.ts` | API endpoint (replaces `pages/api`); exports HTTP method handlers |

---

## Step-by-Step Process

### 1. Server vs Client Components

```tsx
// ✅ Server Component (default) — can be async, can fetch data
// app/products/page.tsx
export default async function ProductsPage() {
  const products = await fetch('https://api.example.com/products', {
    next: { revalidate: 60 }, // ISR: revalidate every 60s
  }).then((r) => r.json());

  return <ProductList products={products} />;
}

// ✅ Client Component — only when you need state/effects/browser APIs
// components/AddToCart.tsx
'use client';
import { useState } from 'react';

export function AddToCart({ productId }: { productId: string }) {
  const [added, setAdded] = useState(false);
  return (
    <button onClick={() => setAdded(true)}>
      {added ? 'Added!' : 'Add to cart'}
    </button>
  );
}
```

**Rules:**
- Pass only **serializable props** from Server → Client Components (no functions, no class instances)
- Keep Client Components as leaf nodes; wrap them in Server Component shells

### 2. Data Fetching & Suspense

```tsx
// app/blog/[slug]/page.tsx
import { Suspense } from 'react';

// SSG: generate static pages at build time
export async function generateStaticParams() {
  const posts = await fetch('https://api.example.com/posts').then((r) => r.json());
  return posts.map((p: { slug: string }) => ({ slug: p.slug }));
}

export default async function BlogPost({ params }: { params: { slug: string } }) {
  const post = await fetch(`https://api.example.com/posts/${params.slug}`, {
    cache: 'force-cache', // static
  }).then((r) => r.json());

  return (
    <>
      <h1>{post.title}</h1>
      <Suspense fallback={<p>Loading comments…</p>}>
        <Comments postId={post.id} />
      </Suspense>
    </>
  );
}
```

### 3. Route Handlers

```ts
// app/api/users/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page = Number(searchParams.get('page') ?? 1);
  const users = await db.user.findMany({ skip: (page - 1) * 20, take: 20 });
  return NextResponse.json({ users, page });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const user = await db.user.create({ data: body });
  return NextResponse.json(user, { status: 201 });
}
```

### 4. Middleware

```ts
// middleware.ts (project root)
import { NextRequest, NextResponse } from 'next/server';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

export function middleware(req: NextRequest) {
  const token = req.cookies.get('access_token')?.value;
  const locale = req.cookies.get('locale')?.value ?? 'es';
  const { pathname } = req.nextUrl;

  if (!token && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL(`/${locale}/login`, req.url));
  }
  return NextResponse.next();
}
```

### 5. Server Actions

```tsx
// app/contact/actions.ts
'use server';
import { revalidatePath, revalidateTag } from 'next/cache';

export async function submitContactForm(formData: FormData) {
  const name = formData.get('name') as string;
  const email = formData.get('email') as string;
  await db.contact.create({ data: { name, email } });
  revalidatePath('/admin/contacts');
  revalidateTag('contacts');
}

// app/contact/page.tsx (Server Component)
import { submitContactForm } from './actions';
export default function ContactPage() {
  return (
    <form action={submitContactForm}>
      <input name="name" required />
      <input name="email" type="email" required />
      <button type="submit">Send</button>
    </form>
  );
}
```

### 6. Metadata

```tsx
// app/blog/[slug]/page.tsx
import type { Metadata } from 'next';

export async function generateMetadata(
  { params }: { params: { slug: string } }
): Promise<Metadata> {
  const post = await fetch(`https://api.example.com/posts/${params.slug}`).then((r) => r.json());
  return {
    title: post.title,
    description: post.excerpt,
    openGraph: { title: post.title, images: [post.coverImage] },
  };
}
```

---

## Verification Checklist

- [ ] `'use client'` only on components that use hooks, event handlers, or browser APIs
- [ ] Serializable props only crossing Server → Client boundary
- [ ] `fetch()` calls include explicit `cache` or `next.revalidate` options
- [ ] Server Actions have `'use server'` directive and call `revalidatePath`/`revalidateTag`
- [ ] Middleware `matcher` excludes static assets
- [ ] Route handlers return `NextResponse.json()` with correct HTTP status
- [ ] `generateStaticParams` exported for dynamic SSG routes
- [ ] `generateMetadata` exported for all public-facing pages
- [ ] **granja_mari_pepa**: `backend/`, `tokens.css`, root `layout.tsx` are untouched
