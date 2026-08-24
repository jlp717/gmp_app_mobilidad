#!/usr/bin/env bash
set -e
# PostToolUse: formatea tras cada Edit/Write
FILE=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
if [[ "$FILE" == *.dart ]]; then dart format "$FILE" 2>/dev/null || true; fi
exit 0
