# ADR-0019 — Vendor-col LACLAE: objetivos vs comisiones

- Estado: Aceptada con deuda conocida (ver Matriz)
- Fecha: 2026-09-25
- Modelo: Muse Spark 1.3 (maximo)
- Decisor: Javier
- Etiquetas: LACLAE, R1_T8CDVD, LCCDVD, objetivos, comisiones, year-aware

## Contexto

LACLAE tiene dos columnas de vendedor con significado distinto:
`R1_T8CDVD` = quien tiene el cliente asignado; `LCCDVD` = quien vendio.
Mezclarlas descuadra objetivos contra comisiones, sobre todo con el corte
marzo 2026 (ene/feb en logica vieja). Varias vistas (dashboard, rutero,
chatbot, KPI, evolution) arrastraban dudas sobre cual columna usaban.

## Decision

Regla fija, sin deriva por entorno:

- Objetivos = `R1_T8CDVD` (titular del cliente).
- Comisiones sales = `LCCDVD` (quien vendio).
- Fijado en codigo: `COMMISSION_SALES_VENDOR_COLUMN = 'LCCDVD'`,
  `COMMISSION_OBJECTIVE_VENDOR_COLUMN = 'R1_T8CDVD'` en
  `backend/utils/common.js`; helpers `getVendorColumn(year, month)`,
  `getVendorColumnExpr(alias)`, `getCommissionVendorColumnExpr(alias, purpose)`.
- Transicion: `VENDOR_COLUMN = R1_T8CDVD` por defecto;
  `getVendorColumn` devuelve `LCCDVD` antes de marzo 2026;
  `DSEDAC.LAC` siempre `LCCDVD` (`forLACTable`, sin `R1_T8CDVD`).
- Objectives/evolution ya aplican el predicado mixto
  `(LCMMDC < 3 AND LCCDVD) OR (LCMMDC >= 3 AND R1_T8CDVD)`.

## Consecuencias

Positivas:
- Objetivos y comisiones dejan de derivar con `VENDOR_COLUMN` del entorno.
- Regla auditable en un solo fichero (`utils/common.js`).

Negativas / riesgos (deuda viva):
- Vistas dudosas pendientes de plan year-aware (sin aplicar; toca dinero):
  dashboard, rutero, chatbot, KPI, evolution fuera de objectives.
  Plan existe, no aplicado: extender `getVendorColumnExpr` /
  `getCommissionVendorColumnExpr` ano a ano en cada vista.

## Evidencias

Ficheros (verificados con Glob esta sesion):
- `backend/utils/common.js` (`VENDOR_COLUMN`, `COMMISSION_SALES_VENDOR_COLUMN`,
  `COMMISSION_OBJECTIVE_VENDOR_COLUMN`, `getVendorColumn`,
  `getVendorColumnExpr`, `getCommissionVendorColumnExpr`)
- `backend/routes/objectives.js` (correcto: predicado mixto `LCMMDC < 3 / >= 3`)
- `backend/routes/commissions.js` (correcto: columnas fijas de comision)
- `backend/routes/dashboard.js` (dudoso: pendiente year-aware)
- `backend/routes/evolution.js` (dudoso: pendiente year-aware)
- `backend/routes/chatbot.js` (dudoso: pendiente year-aware)
- `backend/kpi/routes.js` (dudoso: pendiente year-aware)
- `backend/services/evolution.service.js` (dudoso: pendiente year-aware)

Gates:
- Gate objetivos: usa `R1_T8CDVD` desde marzo 2026, `LCCDVD` antes.
- Gate comisiones: sales siempre `LCCDVD`, objective siempre `R1_T8CDVD`.
- Gate deuda: dashboard/rutero/chatbot/KPI/evolution marcados dudosos hasta
  aplicar plan year-aware; sin cierre falso.
