---
name: seo-optimization
description: SEO for Next.js App Router — Metadata API, JSON-LD, Core Web Vitals, sitemap, robots.txt, canonical URLs, hreflang.
---

# SEO Optimization — Next.js App Router Professional Guide

## Overview

Next.js 14 App Router provides first-class SEO primitives: the Metadata API replaces `next/head`, `app/sitemap.ts` generates dynamic sitemaps, and `app/robots.ts` controls crawling. This guide covers the complete SEO surface area including structured data, Core Web Vitals optimization, and internationalization signals.

## When to Use

- Setting up SEO on a new Next.js App Router project
- Migrating from Pages Router (replace `next/head` with Metadata API)
- Improving Core Web Vitals scores for organic search ranking
- Adding structured data for rich results (articles, products, breadcrumbs)

## When NOT to Use

- Single Page Apps served entirely client-side — metadata won't be crawled; SSR is required
- Internal tools or dashboards with no public indexing requirement

---

## Step-by-Step Process

### 1. Static Metadata

```ts
// app/layout.tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.example.com'),
  title: {
    default: 'Example App',
    template: '%s | Example App',  // Page title becomes "Product Name | Example App"
  },
  description: 'Your definitive guide to example things.',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://www.example.com',
    siteName: 'Example App',
    images: [{ url: '/og-default.png', width: 1200, height: 630, alt: 'Example App' }],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@exampleapp',
    creator: '@exampleapp',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
};
```

### 2. Dynamic Metadata — `generateMetadata()`

```ts
// app/blog/[slug]/page.tsx
import type { Metadata, ResolvingMetadata } from 'next';
import { notFound } from 'next/navigation';
import { getPost } from '@/lib/posts';

interface Props {
  params: { slug: string };
}

export async function generateMetadata(
  { params }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const post = await getPost(params.slug);
  if (!post) return {}; // notFound() called in page component

  const parentOpenGraph = (await parent).openGraph;

  return {
    title: post.title,
    description: post.excerpt,
    authors: [{ name: post.author.name, url: `/authors/${post.author.slug}` }],
    openGraph: {
      ...parentOpenGraph,
      type: 'article',
      title: post.title,
      description: post.excerpt,
      publishedTime: post.publishedAt.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      authors: [`https://www.example.com/authors/${post.author.slug}`],
      images: [
        {
          url: post.ogImage ?? '/og-default.png',
          width: 1200,
          height: 630,
          alt: post.title,
        },
      ],
    },
    alternates: {
      canonical: `https://www.example.com/blog/${params.slug}`,
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const post = await getPost(params.slug);
  if (!post) notFound();
  return <article>{/* ... */}</article>;
}
```

### 3. JSON-LD Structured Data

Use `next/script` with `type="application/ld+json"` inside the component (not layout) for page-specific schemas.

```tsx
// components/JsonLd.tsx
import Script from 'next/script';

interface JsonLdProps {
  data: Record<string, unknown>;
}

export function JsonLd({ data }: JsonLdProps) {
  return (
    <Script
      id="json-ld"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
```

```tsx
// app/blog/[slug]/page.tsx — Article schema
<JsonLd data={{
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: post.title,
  description: post.excerpt,
  image: `https://www.example.com${post.ogImage}`,
  author: {
    '@type': 'Person',
    name: post.author.name,
    url: `https://www.example.com/authors/${post.author.slug}`,
  },
  publisher: {
    '@type': 'Organization',
    name: 'Example App',
    logo: { '@type': 'ImageObject', url: 'https://www.example.com/logo.png' },
  },
  datePublished: post.publishedAt.toISOString(),
  dateModified: post.updatedAt.toISOString(),
  mainEntityOfPage: { '@type': 'WebPage', '@id': `https://www.example.com/blog/${post.slug}` },
}} />
```

```tsx
// BreadcrumbList schema
<JsonLd data={{
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://www.example.com' },
    { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://www.example.com/blog' },
    { '@type': 'ListItem', position: 3, name: post.title, item: `https://www.example.com/blog/${post.slug}` },
  ],
}} />
```

### 4. Sitemap — `app/sitemap.ts`

```ts
// app/sitemap.ts
import type { MetadataRoute } from 'next';
import { getAllPosts } from '@/lib/posts';
import { getAllProducts } from '@/lib/products';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getAllPosts();
  const products = await getAllProducts();

  const postEntries: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `https://www.example.com/blog/${post.slug}`,
    lastModified: post.updatedAt,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  const productEntries: MetadataRoute.Sitemap = products.map((product) => ({
    url: `https://www.example.com/products/${product.slug}`,
    lastModified: product.updatedAt,
    changeFrequency: 'daily',
    priority: 0.9,
  }));

  return [
    { url: 'https://www.example.com', lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: 'https://www.example.com/blog', lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
    ...postEntries,
    ...productEntries,
  ];
}
```

For very large sites, use `generateSitemaps()` to split into multiple sitemap files:

```ts
// app/blog/sitemap.ts
export async function generateSitemaps() {
  const count = await getPostCount();
  const pages = Math.ceil(count / 50_000);
  return Array.from({ length: pages }, (_, i) => ({ id: i }));
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const posts = await getPosts({ skip: id * 50_000, take: 50_000 });
  return posts.map((post) => ({ url: `https://www.example.com/blog/${post.slug}`, lastModified: post.updatedAt }));
}
```

### 5. robots.ts

```ts
// app/robots.ts
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/api/', '/admin/', '/_next/'] },
      { userAgent: 'Googlebot-Image', allow: '/images/' },
    ],
    sitemap: 'https://www.example.com/sitemap.xml',
    host: 'https://www.example.com',
  };
}
```

### 6. Core Web Vitals — LCP, CLS, INP

```tsx
// LCP: hero image — use priority to trigger preload
import Image from 'next/image';

<Image
  src="/hero.jpg"
  alt="Product hero shot"
  width={1200}
  height={600}
  priority                // Adds <link rel="preload as="image">
  sizes="(max-width: 768px) 100vw, 1200px"
  className="hero-image"
/>
```

```tsx
// CLS prevention: always set dimensions; use aspect-ratio for dynamic content
<div style={{ aspectRatio: '16/9', position: 'relative' }}>
  <Image src={src} alt={alt} fill className="object-cover" />
</div>
```

### 7. Canonical & hreflang (i18n)

```ts
// app/[locale]/blog/[slug]/page.tsx
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return {
    alternates: {
      canonical: `https://www.example.com/en/blog/${params.slug}`,
      languages: {
        'en-US': `https://www.example.com/en/blog/${params.slug}`,
        'es-ES': `https://www.example.com/es/blog/${params.slug}`,
        'x-default': `https://www.example.com/en/blog/${params.slug}`,
      },
    },
  };
}
```

---

## Verification Checklist

- [ ] `metadataBase` set in root layout to enable absolute URL resolution
- [ ] Every page has unique `title` and `description` (not duplicated from layout)
- [ ] `generateMetadata()` returns `{}` (not throws) for 404 resources
- [ ] Open Graph image is 1200×630px; alt text provided
- [ ] Twitter card type is `summary_large_image` for article/product pages
- [ ] `app/sitemap.ts` exports all indexable public URLs; excludes `/api/`, `/admin/`
- [ ] `app/robots.ts` disallows API and admin routes
- [ ] JSON-LD validated with Google Rich Results Test
- [ ] LCP element (hero image) has `priority` prop on next/image
- [ ] All images have explicit `width`/`height` or `fill` with aspect-ratio container (no CLS)
- [ ] Canonical URL set on all pages, especially paginated or filtered views
- [ ] `hreflang` alternates present on all localized pages including `x-default`
- [ ] Lighthouse SEO score ≥ 95 on key landing pages
