# FASE 1 — Diagnostico honesto y right-sizing

## Escala vs infraestructura real
- Objetivo declarado: app movil produccion para red comercial (JEFE/COMERCIAL/REPARTIDOR), datos financieros deuda/comisiones/objetivos + 3484 lineas rutero_detail_modal (deuda).
- Infra: PM2 single host 192.168.1.230, DB2 i 192.168.1.22, sin orquestacion contenedores. Escala actual: decenas concurrentes, no cientos. Contenedores/orquestacion NO necesarios a 12 meses salvo que volumen 10x.
- Right-sizing: mantener PM2 + expand-and-contract, anadir flags para canary. No migrar a K8s por aspiracion.

## Riesgos mayores (prob x impacto)
1. **Regresion por cambio local no local** (5.4): 6.08%->1.82% con grafo impacto. Sin gate, riesgo alto. Mitiga: Repo-Explorer consulta grafo antes de edit.
2. **Secretos en commit** (5.7): Gitleaks pre-commit faltante como bloqueo real. Mitiga: hook PreToolUse + TruffleHog CI.
3. **Memoria TRACE faltante** (5.11): 57.5% violacion restricciones. Mitiga: ciclo 6 pasos (Fase 2).
4. **MCP desalineado 2026-07-28** (5.1): incompatibilidad silently. Mitiga: verificar version cada servidor.
5. **Multi-agente sobre-delegacion** (5.2): 2x coste por +2.1pp. Mitiga: 1 writer por modulo, fan-out solo lectura.
