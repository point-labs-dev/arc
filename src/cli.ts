#!/usr/bin/env bun
/**
 * Arc CLI
 * 
 * Commands:
 *   arc plan                - Start planning UI
 *   arc run plan.json       - Execute plan (Arc mode)
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
  --crank          Hand-crank mode: pause after each iteration
  --max-iter <n>   Maximum iterations (default: 50)
  --load <file>    Load existing plan for editing

Environment:
  ANTHROPIC_API_KEY    Claude API key (required)
  OPENAI_API_KEY       OpenAI API key (alternative)
  ARC_PROVIDER         LLM provider: anthropic|openai (default: anthropic)
  ARC_MODEL            Model override

Examples:
  arc plan                     Start a new planning session
  arc plan --load plan.json    Resume planning from file
  arc run plan.json            Execute until complete
  arc run plan.json --crank    Execute with manual control

Philosophy:
  Arc implements the agentic loop pattern - a continuous loop that 
  runs until the task is complete. Like an electric arc shaping metal,
  or a story arc reaching its conclusion.
  
  Hand-crank mode lets you observe and tune the agent like a guitar.
  Each time Arc does something wrong, you adjust the prompt.
  Eventually, Arc learns all the signs.

Inspired by: https://ghuntley.com/ralph
`

interface Args {
  command: "plan" | "run" | "status" | "help"
  planFile?: string
  loadFile?: string
  crankMode: boolean
  maxIterations: number
}

const parseArgs = (argv: string[]): Args => {
  const args: Args = {
    command: "help",
    crankMode: false,
    maxIterations: 50,
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
        args.maxIterations = parseInt(argv[++i] || "50")
        break
      case "--load":
      case "-l":
        args.loadFile = argv[++i]
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
        console.error("Usage: arc run <plan.json> [--crank]")
        process.exit(1)
      }
      const { runRunCommand } = await import("./commands/run")
      await Effect.runPromise(
        runRunCommand(args.planFile, {
          crankMode: args.crankMode,
          maxIterations: args.maxIterations,
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
