---
name: animation-gsap
description: GSAP ScrollTrigger: timelines, parallax, batch processing.
---

# Skill: animation-gsap — GSAP en granja_mari_pepa

GSAP 3 con ScrollTrigger, SplitText y timelines. Stack: React + Next.js 14 App Router.

## Setup en Next.js (App Router)

```tsx
// SIEMPRE useLayoutEffect (no useEffect) para GSAP en React
// SIEMPRE gsap.context() para cleanup correcto

'use client';
import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText'; // GSAP Club plugin

gsap.registerPlugin(ScrollTrigger, SplitText);

export function HeroSection() {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      // Animaciones aquí — scope automático al containerRef
      gsap.from('.hero-title', {
        y: 80,
        opacity: 0,
        duration: 1.4,
        ease: 'power3.out',
      });

      gsap.from('.hero-subtitle', {
        y: 40,
        opacity: 0,
        duration: 1,
        delay: 0.3,
        ease: 'power2.out',
      });
    }, containerRef); // scope = solo afecta elementos dentro del ref

    return () => ctx.revert(); // OBLIGATORIO: cleanup completo
  }, []);

  return (
    <div ref={containerRef}>
      <h1 className="hero-title">Granja Mari Pepa</h1>
      <p className="hero-subtitle">Desde el campo a tu mesa</p>
    </div>
  );
}
```

## ScrollTrigger — Animaciones en Scroll

```tsx
useLayoutEffect(() => {
  const ctx = gsap.context(() => {
    // Fade in al entrar en viewport
    gsap.utils.toArray<HTMLElement>('.fade-in-section').forEach((el) => {
      gsap.from(el, {
        scrollTrigger: {
          trigger: el,
          start: 'top 85%',
          end: 'top 50%',
          once: true, // Performance: no re-trigger
        },
        y: 50,
        opacity: 0,
        duration: 0.9,
        ease: 'power2.out',
      });
    });

    // Parallax background
    gsap.to('.parallax-bg', {
      scrollTrigger: {
        trigger: '.parallax-section',
        start: 'top bottom',
        end: 'bottom top',
        scrub: 1.5, // smooth scrubbing
      },
      y: -100,
      ease: 'none',
    });
  }, containerRef);

  return () => ctx.revert();
}, []);
```

## Timeline — Secuencias Coordinadas

```tsx
const tl = gsap.timeline({
  scrollTrigger: {
    trigger: '.products-section',
    start: 'top 70%',
    once: true,
  },
});

tl.from('.section-title', { y: 40, opacity: 0, duration: 0.8 })
  .from('.product-card', {
    y: 60,
    opacity: 0,
    duration: 0.6,
    stagger: 0.12, // entrada escalonada
    ease: 'power2.out',
  }, '-=0.3') // overlap con animación anterior
  .from('.cta-button', { scale: 0.9, opacity: 0, duration: 0.4 }, '-=0.2');
```

## SplitText — Animación de Texto

```tsx
const split = new SplitText('.animated-heading', { type: 'words,chars' });

gsap.from(split.chars, {
  opacity: 0,
  y: 30,
  rotateX: -90,
  stagger: 0.02,
  duration: 0.6,
  ease: 'power3.out',
  onComplete: () => split.revert(), // cleanup del split
});
```

## prefers-reduced-motion (OBLIGATORIO)

```tsx
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

gsap.from('.card', {
  y: prefersReduced ? 0 : 60,
  opacity: prefersReduced ? 1 : 0,
  duration: prefersReduced ? 0 : 0.8,
});
```

## Integración con Lenis

```tsx
// Lenis debe estar activo ANTES de ScrollTrigger
// Pausar Lenis al abrir modales/overlays
import Lenis from 'lenis';

const lenis = new Lenis({ duration: 1.2, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });

// Conectar con GSAP ticker
gsap.ticker.add((time) => lenis.raf(time * 1000));
gsap.ticker.lagSmoothing(0);

// Pausar para modal
const openModal = () => {
  lenis.stop();
  // abrir modal...
};
const closeModal = () => {
  lenis.start();
};
```

## Anti-patrones
- `useEffect` en lugar de `useLayoutEffect` → flash visual
- Olvidar `ctx.revert()` → memory leaks y animaciones duplicadas
- Animar `width`/`height` → usar `scaleX`/`scaleY` para performance
- `will-change: transform` en > 3 elementos → degradación GPU mobile
- ScrollTrigger sin `once: true` para animaciones de entrada → re-trigger molesto
