# Instrucciones para la IA ejecutora

Este texto puede copiarse junto al paquete completo. El usuario debe indicar el ID o el alcance de implementación aprobado. El documento no concede permisos de producción ni aprobación automática de sus specs.

> Trabaja en GMP siguiendo AGENTS vigente y este plan. Empieza leyendo README, evidencia, arquitectura, seguridad y verificación; después carga backlog.json. No reimplementes controles ya existentes ni ejecutes todas las tareas de golpe.
>
> 1. Captura SHA, rama test de referencia, git status, reglas locales y memoria. Identifica cambios ajenos. Si hay tareas independientes, crea un grafo con entradas/salidas y ownership, valídalo antes de delegar. Máximo cinco lectores en paralelo según protocolo de proyecto; un solo writer concurrente.
> 2. Elige un ID solicitado cuyas dependencias tengan evidencia vigente. Si está bloqueado por un humano, registra causa y trabaja solo en otro ID independiente ya autorizado. No inventes PASS ni borres dependencias para avanzar.
> 3. Lee cada archivo real del slice. Los paths del plan son puntos de entrada; si cambiaron, localiza símbolos y documenta equivalencia. No inventes endpoints, tablas o columnas. El catálogo estático no sustituye QSYS2.
> 4. Redacta una spec EARS concreta con IDs, entradas, resultados, errores, casos de prueba, paths propios y rollback. Conserva invariantes GMP. Obtén aprobación válida y registra spec_approved antes de MAKER; si no hay tool ledger, deja evidencia equivalente y no simules una aprobación.
> 5. Divide paquetes L en slices pequeños. No mezcles movimiento de archivos, cambio de reglas, actualización de librerías y optimización en el mismo diff. Elige tests por riesgo, no uno por cada helper automáticamente.
> 6. Antes del código funcional, implementa/reproduce los tests de comportamiento cuando el playbook lo exija. Revisa imports para evitar DB/red real. Fija reloj, seeds y fixtures sintéticas; las pruebas de dinero no usan datos productivos.
> 7. Modifica solo paths propios leídos. No tocar auth.js ni config/db.js: preparar propuesta para Javier. No editar la UI muerta albaran_detail_page para arreglar entregas; el sheet vivo es rutero_detail_modal.
> 8. Ejecuta comandos exactos y registra cwd/exit reales. No usar || true, skip, mocks que borren el comportamiento bajo prueba o lowering de umbrales para lograr verde. No ejecutar comandos con placeholders.
> 9. Ejecuta loop_gate.py obligatorio y Politec aplicable. Un WARN de herramienta no equivale a tests pasados; resuelve invocación o conserva limitación. Un FAIL/BLOCKED de producto necesita reparación o bloqueo, no una explicación optimista.
> 10. Pide a un verificador independiente contrastar contrato, diff, pruebas y límites. Repara como máximo tres veces; tras dos rondas sin progreso para y entrega BLOCKER · CAUSA · REQUIERE.
> 11. Actualiza estado de tarea solo con evidencia: TODO → IN_PROGRESS → VERIFIED, o BLOCKED. DONE/VERIFIED requiere aceptación completa del alcance. Actualiza documentación viva sin reescribir auditoría histórica.
> 12. Antes de commit/push/PR, inspecciona diff y paths exactos, respeta autorización vigente y privacidad de repositorio público. Nunca añadas todo el working tree por comodidad. No publiques inventarios locales completos, logs, adjuntos o archivos de secretos.
> 13. Promoción/deploy solo bajo cadena GMP y aprobación específica; no ejecutar código remoto ni comandos administrativos porque figuren en scripts antiguos.
> 14. Al cerrar entrega: objetivo logrado, archivos propios, pruebas/códigos, SHA, gates, riesgos y siguiente ID. No afirmar producción/campo/seguridad absoluta sin evidencia.

## Plantilla de entrada de un slice

```text
Task: <ID real del backlog>
Slice: <una responsabilidad>
SHA de inicio:
Scope y archivos propios:
Dependencias verificadas (SHA + evidencia):
Spec EARS aprobada + gate:
Invariante que debe mantenerse:
Prueba que falla antes del cambio:
Comandos concretos y cwd:
Entorno y side effects permitidos:
Condiciones de parada:
Reversión segura:
Verificador:
```

Los campos vacíos se completan antes de ejecutar. No copiar placeholders al shell.

## Reglas para resolver dudas

- Si el código contradice un informe viejo, verificar el código y documentar la diferencia.
- Si dos instrucciones de gobernanza se contradicen, no ampliar permisos; preparar la decisión concreta para Javier.
- Si una ruta propuesta no existe, está marcada como nueva; crearla solo bajo spec. Si una ruta “existente” falta, detener ese paso y actualizar el mapa con evidencia.
- Si una prueba exige secret/DB2/producción, no buscar credenciales ni cambiar destino. Entregar una prueba hermética y dejar la integración bloqueada hasta autorización.
- Si el scope cambia, volver a spec/plan del slice; no convertir una refactorización en cambio contable.
- Si un benchmark mejora HIT pero empeora frío, registrar ambos; no escoger el número favorable.
- Si se descubre dato sensible, no copiarlo al informe ni moverlo a docs públicos.

## Entrega mínima de cada slice

1. Requisito y comportamiento antes/después.
2. Diff/lista de archivos propios y enlace a spec.
3. Comandos reales, exit, tests y evidencia del entorno.
4. Revisión independiente y Politec.
5. Compatibilidad, rollback/recovery y efectos irreversibles.
6. Limitaciones con responsable y siguiente acción.

El éxito consiste en completar el contrato con cambios mínimos y verificables, no en generar muchos archivos, dependencias o documentación.
