---
name: granja-nextjs-shadcn
description: Granja Mari Pepa — Next.js App Router + Express + Tailwind + shadcn/ui + IBM Db2 for i. Use when working on granja_mari_pepa. Covers frontend stack, backend separation, and project rules.
---

# Granja Mari Pepa — Next.js Project Skill

## Overview

Granja Mari Pepa is a web application built with Next.js App Router for frontend and Express.js for backend, connecting to IBM i / DB2 via ODBC.

## Stack

- Frontend: Next.js 14.2.15 (App Router) + React 18 + Tailwind CSS + shadcn/ui
- Motion: CSS transitions, IntersectionObserver (no GSAP en home)
- State: Zustand
- Forms: react-hook-form + Zod
- Backend: Express.js (separado en `backend/`) — NO Next.js API routes
- DB: IBM Db2 for i via ODBC
- TypeScript strict mode

## Critical Rules

1. NO modificar `backend/` — Express es el backend
2. NO modificar `.opencode/CONTEXT.md` — backend contracts
3. NO modificar `name` de inputs — matchean backend
4. NO usar Next.js API routes — Express es el backend
5. NO console.log/print en producción
6. NO `any`/`dynamic`/`Object` sin justificación

## Anti-AI-loop (prohibido)

- Gradientes blue-purple-pink
- Glow shadows decorativos
- Glassmorphism sin función
- Copy genérico ("equipo de expertos")
- Preloader / cursor custom
- Animaciones sin propósito

## Design System

- Tailwind v4 config centralizada
- shadcn/ui components (personalizados según design tokens)
- Responsive mobile-first
- WCAG AA compliance
- Core Web Vitals: LCP <2.5s, INP <200ms, CLS <0.1

## Backend

- Express.js en `backend/` con ODBC a DB2
- Rutas en `backend/routes/`, servicios en `backend/services/`
- Queries DB2 parametrizadas siempre
- Schema cualificado `SCHEMA.TABLA`

## Redesign Status

Fases F0-F6 completadas. Ver `REDESIGN_EXECUTION.md` y `MOTION_GUIDELINES.md` para referencias de diseño.
