---
name: frontend-design
description: Componentes React 19 + Tailwind + Shadcn UI. Pixel-perfect, accesible, animado.
---

# Skill: frontend-design — Componentes React 19

Guía completa para construir componentes web de primer nivel con el stack de granja_mari_pepa.

## Checklist Pre-Implementación
- [ ] ¿Existe ya un componente similar en Shadcn/ui que pueda reutilizarse?
- [ ] ¿Están definidos los tokens de diseño en `tokens.css`?
- [ ] ¿Hay especificación de diseño (visual o textual)?
- [ ] ¿El componente es Server Component o necesita `'use client'`?

## Proceso de Implementación

### 1. Decidir Server vs Client Component
```tsx
// Server Component (por defecto): sin hooks, sin eventos
// ✅ Preferir siempre que sea posible
export default async function ProductList() {
  const products = await getProducts(); // fetch directo en server
  return <ul>{products.map(p => <ProductCard key={p.id} product={p} />)}</ul>;
}

// Client Component: solo cuando necesitas useState/useEffect/event handlers
'use client';
export function InteractiveFilter() {
  const [filter, setFilter] = useState('all');
  ...
}
```

### 2. Componente con Tailwind + Shadcn/ui
```tsx
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const cardVariants = cva(
  'rounded-lg border bg-card text-card-foreground shadow-sm',
  {
    variants: {
      size: { sm: 'p-4', md: 'p-6', lg: 'p-8' },
      variant: { default: '', highlighted: 'border-primary bg-primary/5' },
    },
    defaultVariants: { size: 'md', variant: 'default' },
  }
);

interface ProductCardProps extends VariantProps<typeof cardVariants> {
  product: Product;
  className?: string;
}

export function ProductCard({ product, size, variant, className }: ProductCardProps) {
  return (
    <article className={cn(cardVariants({ size, variant }), className)}>
      <h3 className="text-lg font-semibold">{product.name}</h3>
    </article>
  );
}
```

### 3. Animación con Framer Motion
```tsx
'use client';
import { motion, useReducedMotion } from 'framer-motion';

export function AnimatedCard({ children }: { children: React.ReactNode }) {
  const shouldReduce = useReducedMotion();

  return (
    <motion.div
      initial={shouldReduce ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
```

### 4. Accesibilidad Obligatoria
```tsx
// Imagen con alt descriptivo
<Image src={product.image} alt={`Foto de ${product.name}`} width={400} height={300} />

// Botón con aria-label cuando el texto no es suficiente
<button aria-label={`Añadir ${product.name} al carrito`}>
  <ShoppingCart className="h-4 w-4" />
</button>

// Lista de items: role="list" cuando se resetea list-style
<ul role="list" className="list-none p-0">
```

## Anti-patrones (PROHIBIDOS)
- `style={{ color: '#8B6914' }}` → usar `className="text-warm-700"` o variable CSS
- `<div onClick={...}>` → usar `<button>` o `<a>`
- `useEffect` para fetch de datos → usar Server Component o React Query
- Importar iconos de múltiples librerías distintas → estandarizar en Lucide
- `any` en props TypeScript → definir tipo explícito

## Estética granja_mari_pepa
- **Espaciado**: generoso, aireado (padding mínimo `p-6`)
- **Imágenes**: `aspect-video` o `aspect-square` + `object-cover`
- **Tipografía**: heading serif (`font-serif`), body sans
- **Sombras**: sutiles (`shadow-sm`), no agresivas
- **Hover states**: `transition-all duration-300` siempre
