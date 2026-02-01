#!/usr/bin/env bun
/**
 * Ralph CLI
 * 
 * Commands:
 *   ralph plan                - Start planning UI
 *   ralph run plan.json       - Execute plan (Ralph mode)
 *   ralph run plan.json --crank  - Execute one iteration at a time
 */

import { Effect } from "effect"

const HELP = `
Ralph - Agentic Coding Orchestrator

Usage:
  ralph plan [--load <file>]     Start planning UI
  ralph run <plan.json>          Execute plan (continuous)
  ralph run <plan.json> --crank  Execute plan (hand-crank mode)
  ralph status                   Show execution status
  ralph --help                   Show this help

Options:
  --crank          Hand-crank mode: pause after each iteration
  --max-iter <n>   Maximum iterations (default: 50)
  --load <file>    Load existing plan for editing

Environment:
  ANTHROPIC_API_KEY    Claude API key (required)
  OPENAI_API_KEY       OpenAI API key (alternative)
  RALPH_PROVIDER       LLM provider: anthropic|openai (default: anthropic)
  RALPH_MODEL          Model override

Examples:
  ralph plan                     Start a new planning session
  ralph plan --load plan.json    Resume planning from file
  ralph run plan.json            Execute until complete
  ralph run plan.json --crank    Execute with manual control

Philosophy:
  Ralph implements Geoff Huntley's "Ralph Wiggum primitive" - 
  a continuous loop that runs until the task is complete.
  
  Hand-crank mode lets you observe and tune the agent like a guitar.
  Each time Ralph does something wrong, you adjust the prompt.
  Eventually, Ralph learns all the signs.

Learn more: https://ghuntley.com/ralph
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
        console.error("Usage: ralph run <plan.json> [--crank]")
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
