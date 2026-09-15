# DB-01 — Agregados mensuales precalculados de LACLAE (JAVIER.LACLAE_MONTHLY)

status: draft  
date: 2026-09-14  
playbook: BUILD  
id: laclae-monthly  
estado: **BLOCKED** — sin `spec_approved`. Sin DDL. Sin tabla.

## Cómo aprueba Javier

```
gate_set { name: spec_approved, value: PASS, evidence: "DB-01 LACLAE_MONTHLY EARS 2026-09-14" }
```

Hasta entonces no hay MAKER. DDL y escrituras SOLO en esquema JAVIER. Cero INSERT/UPDATE/DELETE/DDL sobre DSEDAC/DSED. Lectura de DSED.LACLAE permitida.

## Requisitos (EARS)

- Cuando existan agregaciones plurianuales de objetivos/comisiones/dashboard, el sistema deberá leer un agregado mensual en `JAVIER.LACLAE_MONTHLY` en lugar de escanear `DSED.LACLAE` fila a fila.
- Mientras el gate `spec_approved` no sea PASS, el sistema no deberá crear ni alterar esa tabla.

## Fuera de alcance (ejecutor 2026-09-15)

No se implementó tabla, job ETL ni cambio de queries. BE-03 permanece como caché interina.
