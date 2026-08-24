#!/usr/bin/env bun

const root = process.cwd()

const autopilot = await import("../tools/mobile-autopilot.ts")
const safety = await import("../tools/mobile-safety-net.ts")
const improve = await import("../tools/continuous-improvement-loop.ts")
const briefing = await import("../tools/mobile-briefing.ts")

const a = await autopilot.default.execute({ mode: "status", startup_phase: true }, { worktree: root })
const s = await safety.default.execute({ strict: false, startup_phase: true }, { worktree: root })
const i = await improve.default.execute({ include_radar: false, max_actions: 5 }, { worktree: root })
const b = await briefing.default.execute({ send_telegram: false, save_obsidian: false }, { worktree: root })

console.log(JSON.stringify({
  autopilot: JSON.parse(a.output).status,
  safety: JSON.parse(s.output).status,
  improvement: JSON.parse(i.output).status,
  briefing: JSON.parse(b.output).status,
}))
