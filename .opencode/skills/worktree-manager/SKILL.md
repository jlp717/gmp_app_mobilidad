---
name: worktree-manager
description: Use when parallel workstreams or long-running agent tasks need filesystem isolation with git worktrees.
---

name: "worktree-manager"
description: "Gestiona git worktrees para aislar workstreams paralelos. Crea, lista, limpia y sincroniza worktrees por task_id."
version: 1
category: "infrastructure"

inputs:
  operation:
    type: string
    enum: ["create", "list", "remove", "cleanup", "sync"]
    required: true
  task_id:
    type: string
    description: "Task ID para nombrar worktree (ej: 20260803-143000-gmp-abcd)"
    required: false
  branch:
    type: string
    description: "Rama base o nueva rama para el worktree"
    required: false
  base_branch:
    type: string
    description: "Rama base desde donde crear (default: main)"
    required: false
    default: "main"
  path:
    type: string
    description: "Ruta custom para worktree (default: ../gmp-worktrees/{task_id})"
    required: false
  force:
    type: boolean
    description: "Forzar remocion aunque haya cambios sin commit"
    required: false
    default: false

outputs:
  worktree_path:
    type: string
    description: "Ruta absoluta del worktree creado"
  branch_name:
    type: string
    description: "Nombre de la rama en el worktree"
  status:
    type: string
    enum: ["created", "exists", "removed", "cleaned", "synced", "error"]
  message:
    type: string

implementation:
  type: "bash"
  script: |
    #!/bin/bash
    set -euo pipefail

    OPERATION="${1:-}"
    TASK_ID="${2:-}"
    BRANCH="${3:-}"
    BASE_BRANCH="${4:-main}"
    CUSTOM_PATH="${5:-}"
    FORCE="${6:-false}"

    REPO_ROOT="$(git rev-parse --show-toplevel)"
    WORKTREES_BASE="${REPO_ROOT}/../gmp-worktrees"

    case "${OPERATION}" in
      create)
        if [[ -z "${TASK_ID}" ]]; then
          echo "ERROR: task_id requerido para create"
          exit 1
        fi

        WT_PATH="${CUSTOM_PATH:-${WORKTREES_BASE}/${TASK_ID}}"
        WT_BRANCH="${BRANCH:-${TASK_ID}}"

        # Crear directorio base si no existe
        mkdir -p "${WORKTREES_BASE}"

        # Verificar si worktree ya existe
        if git worktree list | grep -q "${WT_PATH}"; then
          echo "WORKTREE_EXISTS:${WT_PATH}"
          exit 0
        fi

        # Crear rama si no existe
        if ! git show-ref --verify --quiet "refs/heads/${WT_BRANCH}"; then
          git branch "${WT_BRANCH}" "${BASE_BRANCH}"
        fi

        # Crear worktree
        git worktree add "${WT_PATH}" "${WT_BRANCH}"

        # Copiar archivos de configuracion necesarios
        cp -r "${REPO_ROOT}/.opencode" "${WT_PATH}/.opencode" 2>/dev/null || true
        cp "${REPO_ROOT}/.mcp.json" "${WT_PATH}/.mcp.json" 2>/dev/null || true
        cp "${REPO_ROOT}/opencode.json" "${WT_PATH}/opencode.json" 2>/dev/null || true

        # Instalar deps si hay package.json
        if [[ -f "${WT_PATH}/backend/package.json" ]]; then
          (cd "${WT_PATH}/backend" && npm ci --prefer-offline --no-audit 2>/dev/null || npm install --prefer-offline --no-audit) &
        fi
        if [[ -f "${WT_PATH}/pubspec.yaml" ]]; then
          (cd "${WT_PATH}" && flutter pub get 2>/dev/null) &
        fi

        echo "WORKTREE_CREATED:${WT_PATH}:${WT_BRANCH}"
        ;;

      list)
        git worktree list --porcelain | awk '
          /^worktree / { path=$2 }
          /^branch / { branch=$2; gsub("refs/heads/", "", branch); print path ":" branch }
        '
        ;;

      remove)
        if [[ -z "${TASK_ID}" ]]; then
          echo "ERROR: task_id requerido para remove"
          exit 1
        fi

        WT_PATH="${CUSTOM_PATH:-${WORKTREES_BASE}/${TASK_ID}}"

        if [[ "${FORCE}" == "true" ]]; then
          git worktree remove --force "${WT_PATH}"
        else
          git worktree remove "${WT_PATH}"
        fi

        echo "WORKTREE_REMOVED:${WT_PATH}"
        ;;

      cleanup)
        # Remover worktrees para ramas merged o stale (>30 dias)
        git worktree list --porcelain | awk '
          /^worktree / { path=$2 }
          /^branch / { branch=$2; gsub("refs/heads/", "", branch); paths[branch]=path }
          END {
            for (b in paths) {
              # Verificar si rama merged en main
              if (system("git merge-base --is-ancestor " b " main >/dev/null 2>&1") == 0) {
                print "CLEANUP_MERGED:" paths[b] ":" b
              }
            }
          }
        ' | while IFS=: read -r tag path branch; do
          if [[ "${tag}" == "CLEANUP_MERGED" ]]; then
            git worktree remove "${path}" 2>/dev/null || true
            echo "WORKTREE_CLEANED:${path}:${branch}"
          fi
        done

        # Prune worktrees administrativos
        git worktree prune
        echo "WORKTREE_PRUNED"
        ;;

      sync)
        # Sincronizar worktree con base_branch
        if [[ -z "${TASK_ID}" ]]; then
          echo "ERROR: task_id requerido para sync"
          exit 1
        fi

        WT_PATH="${CUSTOM_PATH:-${WORKTREES_BASE}/${TASK_ID}}"

        if [[ ! -d "${WT_PATH}" ]]; then
          echo "ERROR: Worktree no existe: ${WT_PATH}"
          exit 1
        fi

        (cd "${WT_PATH}" && git fetch origin && git rebase "origin/${BASE_BRANCH}" || git rebase --abort)
        echo "WORKTREE_SYNCED:${WT_PATH}"
        ;;

      *)
        echo "ERROR: Operacion desconocida: ${OPERATION}"
        echo "Uso: worktree-manager <create|list|remove|cleanup|sync> [task_id] [branch] [base_branch] [path] [force]"
        exit 1
        ;;
    esac
