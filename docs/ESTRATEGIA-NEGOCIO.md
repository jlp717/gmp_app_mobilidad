# ESTRATEGIA DE NEGOCIO - Reporte Critico y Modelo Corregido

> Fuente: business-critic (analisis frio 2026-08-12). Este documento codifica el modelo de negocio corregido.

## 1. VEREDICTO DEL CRITICO

VIABLE como boutique de desarrollo verticalizada y bien cobrada. RIESGOSO tal como estaba formulado (ideas indiscriminadas, frontend completo previo, facturacion final, 3-4 proyectos sin soporte).

## 2. RECOMENDACIONES APROBADAS POR JAVIER (2026-08-12)

### R1 - Nicho primero, no ideas indiscriminadas
- Elegir UN sector y UN problema caro antes de construir nada.
- Entrevistar compradores antes de invertir en una demo extensa.
- Criterio: problema urgente + presupuesto + disposicion a pagar.

### R2 - Demo del recorrido comercial decisivo (no frontend completo)
- Construir solo el recorrido comercial decisivo, no todo el producto mockeado.
- Etiquetar SIEMPRE: DEMO - datos simulados.
- Aadir spikes tecnicos para las 3 incertidumbres mas peligrosas (backend, pagos, integraciones).

### R3 - Filtro de 8 semanas antes de comprometerse
- ~15 conversaciones cualificadas.
- 5 demos presentadas.
- Al menos 1 oportunidad con contrato + anticipo cobrado.
- Si no aparece: abandonar o cambiar el problema.

### R4 - Contrato seguro (SOW), no una firma
- SOW cerrado: alcance, exclusiones, criterios de aceptacion, control de cambios.
- Anticipo cobrado antes de empezar produccion.
- Responsable decisor del cliente identificado.
- Propiedad intelectual, licencia, confidencialidad, garantias, SLA, impago, RGPD art.25/28, LSSI art.10.

### R5 - Cobro por hitos
- 30-40% al firmar.
- 20-30% en primer incremento operativo.
- 20-30% en beta.
- 10-20% en aceptacion final.
- Suspension por impago + tarifa de cancelacion.
- Anticipos devengan IVA al cobrarse (Ley 37/1992 art.75).

### R6 - Entregas cada 1-2 semanas (nunca 3-4 meses de silencio)
- Cada hito produce aceptacion o rechazo documentado.
- El cliente ve progreso real continuo.

### R7 - Mantenimiento separado y obligatorio
- Infraestructura, correcciones, actualizaciones, seguridad, SLA.
- No regalar soporte indefinido.
- Cada app genera ingreso recurrente, no pasivo.

### R8 - Verticalizar la reutilizacion
- Core comun: auth, contratos, observabilidad, despliegue, pagos.
- Reglas de negocio y datos aislados por app (sin acoplamiento entre sectores).

## 3. FLUJO CORREGIDO DEL NEGOCIO

1. validacion_mercado: entrevistar compradores del nicho (15 conversaciones, 5 demos).
2. demo_recorrido: construir solo el recorrido comercial decisivo con mocks, etiquetado DEMO.
3. contrato_seguro: SOW cerrado + anticipo cobrado (30-40%).
4. desarrollo_sprints: entregas cada 1-2 semanas por hitos con cobro parcial.
5. mantenimiento: soporte separado y obligatorio tras entrega.
6. siguiente_app: el core comun (auth, pagos, observabilidad) se reutiliza.

## 4. METRICA DE EXITO ANUAL
- 3-4 apps funcionales AL ANIO solo si: nicho definido, contratos con anticipo, entregas quincenales y mantenimiento vendido.
- Coste marginal baja con el core comun: app 1 mas cara, app 5 mucho mas barata.
