#!/usr/bin/env bun
/**
 * Arc CLI
 * 
 * Commands:
 *   arc plan                - Start planning UI
 *   arc run plan.json       - Execute plan via Pi
 *   arc run plan.json --crank  - Execute one iteration at a time
 */

import { Effect } from "effect"

const HELP = `
Arc - Agentic Coding Orchestrator

Energy in, shaped code out. Iteration over iteration until it's right.

Usage:
  arc plan [--load <file>]     Start planning UI
  arc run <plan.json>          Execute plan (continuous)
  arc run <plan.json> --crank  Execute plan (hand-crank mode)
  arc status                   Show execution status
  arc --help                   Show this help

Options:
  --agent <name>       Coding agent to use (codex, claude-code, opencode, pi)
  --crank              Hand-crank mode: pause after each iteration
  --max-iter <n>       Max iterations per step (default: 5)
  --max-no-change <n>  Circuit breaker: max no-change iterations (default: 3)
  --max-total <n>      Max total iterations across all steps (default: 50)
  --load <file>        Load existing plan for editing
  --provider <name>    LLM provider for Pi (anthropic, openai, google, etc.)
  --model <id>         Model ID for Pi
  --auto-approve       Auto-approve changes (--yolo mode for Codex)

Agents:
  codex        OpenAI Codex CLI (gpt-5.2-codex) - install: npm i -g @openai/codex
  claude-code  Anthropic Claude Code - install: npm i -g @anthropic-ai/claude-code
  opencode     OpenCode - install: npm i -g opencode
  pi           Pi Coding Agent - install: npm i -g @mariozechner/pi-coding-agent

Examples:
  arc plan                              Start a new planning session
  arc plan --load plan.json             Resume planning from file
  arc run plan.json                     Execute with default agent (claude-code)
  arc run plan.json --agent pi          Execute with Pi
  arc run plan.json --agent codex       Execute with Codex
  arc run plan.json --crank             Execute with hand-crank mode
  arc run plan.json --agent pi --provider openai   Pi with OpenAI

Philosophy:
  Arc orchestrates coding agents in a continuous loop until the task is complete.
  Like an electric arc shaping metal, or a story arc reaching its conclusion.
  
  Hand-crank mode lets you observe and tune the agent like a guitar.
  Each time Arc does something wrong, you adjust the prompt.
  Eventually, Arc learns all the signs.

Architecture:
  Arc (planning, orchestration)
    → Agent (Codex, Claude Code, OpenCode, Pi)
      → LLM (Claude, GPT, Gemini, etc.)

Inspired by: https://ghuntley.com/ralph
`

type AgentType = "codex" | "claude-code" | "opencode" | "pi"

interface Args {
  command: "plan" | "run" | "status" | "help"
  planFile?: string
  loadFile?: string
  crankMode: boolean
  maxIterations: number
  maxNoChange: number
  maxTotal: number
  agent: AgentType
  provider?: string
  model?: string
  autoApprove: boolean
}

const parseArgs = (argv: string[]): Args => {
  const args: Args = {
    command: "help",
    crankMode: false,
    maxIterations: 5,
    maxNoChange: 3,
    maxTotal: 50,
    agent: "claude-code", // Default to Claude Code
    autoApprove: false,
  }

  let i = 0
  while (i < argv.length) {
    const arg = argv[i]

    switch (arg) {
      case "plan":
        args.command = "plan"
        break
      case "run":
        args.command = "run"
        // Next arg should be plan file
        if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
          args.planFile = argv[++i]
        }
        break
      case "status":
        args.command = "status"
        break
      case "--help":
      case "-h":
        args.command = "help"
        break
      case "--crank":
      case "-c":
        args.crankMode = true
        break
      case "--max-iter":
      case "-m":
        args.maxIterations = parseInt(argv[++i] || "5")
        break
      case "--max-no-change":
        args.maxNoChange = parseInt(argv[++i] || "3")
        break
      case "--max-total":
        args.maxTotal = parseInt(argv[++i] || "50")
        break
      case "--load":
      case "-l":
        args.loadFile = argv[++i]
        break
      case "--agent":
      case "-a":
        const agentArg = argv[++i]?.toLowerCase()
        if (agentArg && ["codex", "claude-code", "opencode", "pi"].includes(agentArg)) {
          args.agent = agentArg as AgentType
        } else {
          console.error(`Invalid agent: ${agentArg}. Use: codex, claude-code, opencode, pi`)
          process.exit(1)
        }
        break
      case "--provider":
        args.provider = argv[++i]
        break
      case "--model":
        args.model = argv[++i]
        break
      case "--auto-approve":
      case "--yolo":
        args.autoApprove = true
        break
      default:
        if (!arg.startsWith("-") && args.command === "help") {
          // First positional arg might be plan file
          if (arg.endsWith(".json")) {
            args.command = "run"
            args.planFile = arg
          }
        }
    }
    i++
  }

  return args
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))

  switch (args.command) {
    case "help":
      console.log(HELP)
      process.exit(0)

    case "plan": {
      const { runPlanCommand } = await import("./commands/plan")
      await Effect.runPromise(runPlanCommand(args.loadFile))
      break
    }

    case "run": {
      if (!args.planFile) {
        console.error("Error: Plan file required")
        console.error("Usage: arc run <plan.json> [--agent <name>] [--crank]")
        process.exit(1)
      }
      const { runRunCommand } = await import("./commands/run")
      await Effect.runPromise(
        runRunCommand(args.planFile, {
          crank: args.crankMode,
          maxIterations: args.maxIterations,
          maxNoChange: args.maxNoChange,
          maxTotal: args.maxTotal,
          agent: args.agent,
          provider: args.provider,
          model: args.model,
          autoApprove: args.autoApprove,
        })
      )
      break
    }

    case "status": {
      console.log("Status command not yet implemented")
      process.exit(1)
    }
  }
}

main().catch((e) => {
  console.error("Fatal error:", e.message || e)
  process.exit(1)
})
