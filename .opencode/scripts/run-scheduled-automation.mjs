#!/usr/bin/env bun
/** Background automation — runs due jobs without blocking OpenCode Web startup. */
import { loadEnv } from "./load-env.mjs"

const root = process.cwd()
await loadEnv(root)

const runner = await import("../tools/scheduled-automation-runner.ts")
const result = await runner.default.execute({ operation: "run_due" }, { worktree: root, directory: root })
console.log(result.output)
