---
name: vercel-deploy
description: Vercel deployment — CLI, env vars, preview/production, rollback, domain, analytics, Next.js output modes.
location: C:\Users\Javier\.config\opencode\skills\vercel-deploy\SKILL.md
---

# Vercel Deploy

## Overview
Vercel es el plataforma de despliegue para Next.js. Gestiona preview deployments automáticos, producción, rollback, edge functions y analytics integradas.

## When to Use
- Desplegar frontend de granja_mari_pepa a Vercel
- Configurar environment variables para staging/production
- Hacer rollback a una versión anterior
- Configurar dominios personalizados
- Revisar logs de deployment
- Gestionar edge functions o ISR

## When NOT to Use
- Backend Node.js/Express (desplegar en VPS propio, no Vercel)
- Bases de datos managed (usar Vercel Postgres, Neon, Supabase, o el VPS)
- WebSockets o long-running processes (no soportados en Vercel)

## Step-by-Step Process

### 1. Setup inicial
```bash
npm i -g vercel
cd frontend
vercel login
vercel link  # vincula al proyecto en vercel.com
```

### 2. Environment variables
```bash
# Pull variables de producción
vercel env pull .env.production

# Añadir variable
vercel env add NEXT_PUBLIC_API_URL

# Listar variables
vercel env list

# Development vs Preview vs Production
vercel env add NEXT_PUBLIC_API_URL --environment development
vercel env add NEXT_PUBLIC_API_URL --environment preview
vercel env add NEXT_PUBLIC_API_URL --environment production
```

### 3. Deployment
```bash
# Preview (automático en cada push a cualquier branch)
vercel

# Producción (solo branch main/master)
vercel --prod

# Branch específico a producción
vercel --prod --token $VERCEL_TOKEN

# Specified build command (por defecto lee package.json scripts)
vercel --prod --build-env NODE_ENV=production
```

### 4. next.config.js output modes
```js
// ISR con revalidate
module.exports = {
  output: 'export',  // Static HTML export (para CDN-only)
  // ó
  images: { unoptimized: true }  // Para export sin image optimization
}

// ISR
module.exports = {
  async rewrites() {
    return [
      { source: '/api/:path*', destination: 'https://backend.example.com/:path*' }
    ]
  }
}
```

### 5. Rollback
```bash
# Listar deployments
vercel ls

# Deploy específico
vercel --prod --target=deploy_xxx

# Desde dashboard: Deployment → ⋮ → "Promote to Production"
```

### 6. Dominios
```bash
# Añadir dominio personalizado
vercel domains add mi-dominio.com

# Verificar DNS
vercel domains verify mi-dominio.com

# Configurar redirect
vercel redirect mi-dominio.com → www.mi-dominio.com
```

### 7. Vercel Analytics
```bash
# Instalar
npm i @vercel/analytics

# En layout.tsx o _app.jsx
import { Analytics } from '@vercel/analytics/react'
<Analytics />
```

### 8. Edge Functions
```bash
# Middleware en src/middleware.ts (Next.js 13+)
import { NextResponse } from 'next/server'
export function middleware(request: Request) {
  return NextResponse.next()
}
```

### 9. CLI flags útiles
```bash
--yes          # Skip confirmation
--token        # Token de API (para CI/CD)
--debug        # Verbose output
--cwd          # Cambiar directorio antes de deploy
--no-bundle    # No bundlar (para testing local)
```

### 10. GitHub Actions CI/CD
```yaml
# .github/workflows/vercel.yml
- name: Deploy to Vercel
  uses: amondnet/vercel-action@v25
  with:
    vercel-token: ${{ secrets.VERCEL_TOKEN }}
    vercel-org-id: ${{ secrets.ORG_ID }}
    vercel-project-id: ${{ secrets.PROJECT_ID }}
    vercel-args: '--prod'
```

## Environment Variables Comunes
| Variable | Uso |
|---|---|
| `NEXT_PUBLIC_API_URL` | URL del backend Express |
| `POSTGRES_CONNECTION_STRING` | Database URL |
| `NEXTAUTH_SECRET` | Auth secret |
| `NEXTAUTH_URL` | Canonical URL |

## Troubleshooting

| Problema | Solución |
|---|---|
| Build falla en Vercel pero no localmente | `vercel env pull` + `vercel build --prod` local para debug |
| ISR no regenera | Verificar `revalidate` en route handlers |
| Edge function timeout | Max 30s en Edge Runtime |
| 404 en assets | Revisar `output: 'export'` vs configuración de build |
| Domain no verifica | Esperar DNS propagation (hasta 48h), usar A record |
| Env var no disponible | Asegurar que está en environment correcto (production) |

## Verification Checklist
- [ ] `vercel login` completado
- [ ] `vercel link` ejecutado y proyecto vinculado
- [ ] Variables de entorno configuradas en dashboard o CLI
- [ ] Dominio personalizado verificado si aplica
- [ ] Preview deploy passing en PRs
- [ ] Deploy a producción funciona
- [ ] Analytics integrando (si aplica)
- [ ] Edge functions probadas si se usan