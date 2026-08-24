#!/usr/bin/env bash
set -e
node "${CLAUDE_PROJECT_DIR}/.claude/hooks/validate-prod.mjs" 2>&1 || exit 2
exit 0
