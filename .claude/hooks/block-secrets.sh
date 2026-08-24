#!/usr/bin/env bash
set -e
# Delega validacion a Node para evitar falsos positivos de scanner
node "${CLAUDE_PROJECT_DIR}/.claude/hooks/validate-secrets.mjs" 2>&1 || exit 2
exit 0
