# 0001 — Monorepo único con dos unidades desplegables (Flutter app + API Express)

- Estado: Aceptada (retroactiva)
- Fecha: 2026-08-25
- Decisores: Javier (@jlp717)
- Etiquetas: repositorio, arquitectura

## Contexto

El repositorio `gmp_app_mobilidad` contiene desde su origen dos unidades desplegables:

1. **App móvil Flutter** (`lib/`, `pubspec.yaml`) — ventas de campo para Granja Maripepa S.L.
2. **API Node.js/Express** (`backend/`, `backend/package.json`) — única puerta de datos hacia DB2.

La recomendación genérica para móvil + backend con ciclos de release independientes es **polyrepo**. Sin embargo, la evidencia del historial muestra que ambos componentes siempre han evolucionado juntos: cada feature de negocio (rutero, cobros, reparto, pedidos) atraviesa UI + endpoint + query en el mismo cambio funcional, hay un solo responsable (@jlp717) y el despliegue del backend está acoplado a la versión de la app que lo consume.

## Decisión

Mantener un **monorepo** único con convenciones compartidas (este repo), documentando las dos unidades desplegables como módulos de primer nivel:

```
gmp_app_mobilidad/
├── lib/            # App Flutter (unidad desplegable 1)
├── backend/        # API Express   (unidad desplegable 2)
├── docs/adr/       # Decisiones de arquitectura
└── package.json    # Solo tooling DX (husky/commitlint/lint-staged). Cero código de producto.
```

Reglas derivadas:
- El `package.json` raíz es **exclusivamente tooling de desarrollo**; el runtime del backend vive en `backend/package.json`.
- Cada unidad desplegable mantiene su propio lockfile, scripts y README (`README.md` raíz + `backend/README.md`).
- Los commits que cruzan la frontera UI↔API son atómicos y describen el contrato afectado.

## Consecuencias

**Positivas**
- Cambios de contrato API+cliente en un solo commit revisable; cero sincronización entre repos.
- Un solo clon = productivo el primer día; CI con filtros por path (`.github/workflows/ci-cd.yml`).
- Convenciones únicas de commits, owners y ADRs.

**Negativas / riesgos**
- Ruido de CI si no se filtran paths (mitigado: workflows filtran por directorio).
- El historial mezcla dominios; mitigado por Conventional Commits + scopes (`feat(rutero):`, `fix(api):`).
- Acoplamiento accidental de releases; mitigado versionando app (`pubspec.yaml`) y backend (`package.json`) por separado.

**Neutras**
- El servidor de imágenes (192.168.1.191) es infraestructura externa compartida, no una tercera unidad.

## Alternativas consideradas

1. **Polyrepo (app / api)** — mejor aislamiento de ciclos; rechazada hoy porque con un equipo de 1–2 personas el coste de sincronizar contratos supera el beneficio. **Trigger de revisitación:** >2 equipos, o ciclos de release genuinamente independientes (p. ej., la API sirve a un segundo cliente no-Flutter).
2. **Monorepo con workspaces npm/puro** — overkill: solo hay un paquete Node; el acoplamiento de tooling raíz ya cubre hooks y lint.
