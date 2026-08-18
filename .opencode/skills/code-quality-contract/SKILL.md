---
name: code-quality-contract
description: >
  Filtro de calidad que sustituye revision humana del codigo de la IA.
  Ejecutar antes de cerrar BUILD/SWEEP/SECURE. PASS = se puede dar por hecho.
---

# Code quality contract

Fuente: `.opencode/config/code-quality-contract.yaml`.
Tool: `code-quality-contract`.

Politec: Purpose, Organization, Legibility, Integration, Tests, Efficiency, Compliance.

Cierre:

1. `elite-quality-gate` sobre el diff.
2. Test del flujo critico con comando y exit code reales.
3. `code-quality-contract` → scorecard en `.opencode/state/code-quality-scorecard-latest.json`.
4. PASS → Chief puede decir hecho. BLOCK → maker itera (max 3).

Javier no tiene que pedir "codigo eficiente", "sin N+1" ni "parametriza SQL". Va en el contrato.
