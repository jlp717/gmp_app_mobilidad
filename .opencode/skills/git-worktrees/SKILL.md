---
name: git-worktrees
description: Git worktrees for parallel isolated development. Create, list, and remove worktrees, work on hotfix and feature simultaneously, integrate with OpenCode agent contexts, and avoid common pitfalls.
---

# Git Worktrees

## Overview

A git worktree lets you check out a different branch into a separate directory on disk — all sharing the same `.git` directory. No stashing, no switching branches, no losing in-progress work. You can have a hotfix branch open in one terminal and a feature branch in another, with fully independent working trees.

```
repo/
├── .git/                    ← shared git internals
├── my-app/                  ← main worktree (main branch)
├── my-app-hotfix/           ← linked worktree (hotfix/critical-bug)
└── my-app-feature-xyz/      ← linked worktree (feature/xyz)
```

## When to Use

- You need to work on a hotfix while a long-running feature branch is in progress
- You want to run the test suite on `main` while actively editing a feature branch
- You are running parallel agents — each agent gets its own worktree (isolated context)
- You need to review a colleague's PR branch without touching your working tree
- You want to compare behavior between two branches side by side

## When NOT to Use

- The same branch in two worktrees simultaneously — git forbids this
- Short context switches (< 10 minutes) — `git stash` is simpler
- Worktrees on remote filesystems — causes performance and locking issues
- You haven't committed or stashed unstaged changes on the branch you want to link — clean state required

---

## Step-by-Step Process

### Step 1 — Create a Worktree

```bash
# Create a new worktree for an existing branch
git worktree add ../my-app-hotfix hotfix/critical-bug

# Create a worktree AND a new branch simultaneously
git worktree add -b feature/xyz ../my-app-feature-xyz main

# Create a worktree from a remote branch
git worktree add ../my-app-review origin/feature/other-dev
```

The second argument (`../my-app-hotfix`) is the filesystem path.  
Place worktrees **outside** the main repo directory to avoid confusing tools that glob recursively.

### Step 2 — Work in the Worktree

The linked worktree is a fully functional working directory:

```bash
cd ../my-app-hotfix

# Normal git workflow
git status
git add .
git commit -m "fix: resolve null pointer in payment flow"

# Run tests
npm test
# or
flutter test
```

Changes in `../my-app-hotfix` are completely isolated from `../my-app`.

### Step 3 — List Worktrees

```bash
git worktree list
```

Output:

```
/home/user/my-app            abc1234 [main]
/home/user/my-app-hotfix     def5678 [hotfix/critical-bug]
/home/user/my-app-feature-xyz  ghi9012 [feature/xyz]
```

### Step 4 — Remove a Worktree

After merging, clean up:

```bash
# Remove the worktree directory and deregister it
git worktree remove ../my-app-hotfix

# If the directory was manually deleted, prune the stale reference
git worktree prune
```

Verify cleanup:

```bash
git worktree list
# Should no longer show the removed worktree
```

### Step 5 — Full Workflow Example

```bash
# 1. You're on main, mid-feature work
cd ~/my-app
git status  # feature work in progress

# 2. Critical bug reported — create isolated hotfix worktree
git worktree add -b hotfix/payment-null ../my-app-hotfix main

# 3. Fix in the hotfix worktree
cd ../my-app-hotfix
# ... edit, test, commit ...
git push origin hotfix/payment-null

# 4. PR merged — return to feature work, uninterrupted
cd ~/my-app
# your feature branch is exactly as you left it

# 5. Rebase feature on updated main
git fetch origin
git rebase origin/main

# 6. Clean up hotfix worktree
git worktree remove ../my-app-hotfix
```

### Step 6 — Integration with OpenCode Parallel Agents

Each worktree becomes an isolated workspace for a separate agent:

```bash
# Create worktrees for parallel agents
git worktree add -b feature/auth ../my-app-auth main
git worktree add -b feature/billing ../my-app-billing main
```

Open OpenCode in each directory:

```bash
# Terminal 1 — Agent working on auth
cd ../my-app-auth
opencode

# Terminal 2 — Agent working on billing
cd ../my-app-billing
opencode
```

Each agent has full git access, its own branch, and no risk of overwriting the other's work.

### Key Constraints and Pitfalls

| Constraint | Detail |
|---|---|
| Same branch, two worktrees | **Forbidden** — git will error. Each branch can only be checked out once. |
| Shared `.git/config` | All worktrees share remotes and config. Changes to remotes are global. |
| Shared stash | `git stash list` shows the same stash across all worktrees. Use branch names to identify stashes. |
| Shared hooks | `.git/hooks/` applies to all worktrees. Ensure hooks are worktree-path-agnostic. |
| Absolute paths in scripts | Some scripts hardcode the repo root. They may fail in linked worktrees — use `git rev-parse --show-toplevel`. |

```bash
# Safe way to get repo root inside any worktree
PROJECT_ROOT=$(git rev-parse --show-toplevel)
```

---

## Verification Checklist

- [ ] Worktree created outside the main repo directory (sibling, not child)
- [ ] A new branch was created for the worktree — not an already-checked-out branch
- [ ] `git worktree list` confirms all expected worktrees are registered
- [ ] Work committed and pushed from the linked worktree before removing it
- [ ] `git worktree remove` used (not manual `rm`) to deregister cleanly
- [ ] `git worktree prune` run after any manual directory deletions
- [ ] No shared mutable files (`.env`, generated files) written to by multiple worktrees simultaneously
- [ ] Hooks tested in the worktree context — not just the main working tree
