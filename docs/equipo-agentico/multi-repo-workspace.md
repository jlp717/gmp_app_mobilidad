# Multi-repo Workspace — Pilar 23

Tres repos independientes: `gmp_app_mobilidad`, `PrΘxenos`, `canal-youtube`. No migrar a monorepo (dominios y ciclos de deploy distintos).

## Patrón recomendado
```
workspace-gmp/           # repo privado workspace
├── .ai/                 # submódulo compartido: skills, AGENTS.md core, guardrails
│   ├── AGENTS.md        # puntero a 3 repos
│   ├── skills/          # checklist seguridad, TRACE, harness
│   └── agent-defs/
├── gmp_app_mobilidad/   # submódulo git
├── proxenos/            # submódulo git
└── canal-youtube/       # submódulo git
```

## Reglas
- Cada agente trabaja solo dentro de su repo. Conflictos entre repos imposibles.
- `.ai/` versionado, cada repo referencia `../.ai/AGENTS.md` en su `AGENTS.md:1`.
- Cambios cross-repo = 3 commits separados + PRs ordenados, no transacción atómica. Ventana de versionado mixto asumida.

Ref: Francis Eytan Dortort 2026.
