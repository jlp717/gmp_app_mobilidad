# FASE 2 — Decisiones arquitectonicas

## Composicion equipo (Sec 6)
Todos aplican. compliance parcial financiero/GDPR (no salud/menores). Ver gmp-app-mobilidad.md cabecera.

## Matriz autonomia
Ver .claude/config/autonomy-matrix.yaml. Conservador default: todo no-bajo requiere confirmacion.

## Memoria TRACE (5.11)
Captura -> destilacion atomica -> compilacion a check runtime (PreToolUse exit 2) -> curacion/caducidad/alcance. Evaluar YujunZhou/tellonce en Fase 3.

## Hooks concretos
PreToolUse Write/Edit: block-secrets.sh -> validate-secrets.mjs
PreToolUse Bash: block-prod-write.sh -> validate-prod.mjs
PostToolUse: lint-and-format.sh
Stop/SubagentStop: require-green-tests.sh (decision block si jest falla)