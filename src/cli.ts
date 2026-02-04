#!/usr/bin/env bun
/**
 * Arc CLI
 * 
 * Rapid iteration product development agent.
 * 
 * Commands:
 *   arc init "goal"           Initialize a new project
 *   arc iterate               Run one iteration (pick task, build, verify, learn)
 *   arc go                    Keep iterating until done or blocked
 *   arc add "task"            Add a task to the backlog
 *   arc status                Show project status
 *   arc plan                  Start planning UI (legacy)
 *   arc run plan.json         Execute a static plan (legacy)
 */

import { Effect } from "effect"

const HELP = `
Arc - Rapid Iteration Product Development Agent

Idea → Plan a piece → Build → Verify → Learn → Repeat

Usage:
  arc init "<goal>"            Initialize a new project with a goal
  arc iterate                  Run one iteration (build next task)
  arc go                       Keep iterating until done or blocked
  arc add "<task>" [--verify]  Add a task to the backlog
  arc status                   Show project status and progress
  arc backlog                  Show the task backlog
  arc insights                 Show learnings and insights
  arc plan                     Start planning UI (legacy)
  arc run <plan.json>          Execute a static plan (legacy)
  arc --help                   Show this help

Options:
  --agent <name>       Coding agent to use (codex, claude-code, opencode, pi)
  --max-attempts <n>   Max attempts per task (default: 5)
  --provider <name>    LLM provider for Pi (anthropic, openai, google, etc.)
  --model <id>         Model ID for Pi
  --auto-approve       Auto-approve changes (--yolo mode for Codex)
  --project <file>     Project file (default: arc-project.json)

Task options (for 'arc add'):
  --verify "<cmd>"     Verification command (runs to check if task is done)
  --why "<reason>"     Why this task matters
  --size <s|m|l>       Task size estimate (small, medium, large)
  --top                Add to top of backlog instead of bottom

Agents:
  codex        OpenAI Codex CLI (gpt-5.2-codex)
  claude-code  Anthropic Claude Code [default]
  opencode     OpenCode
  pi           Pi Coding Agent (multi-provider)

Examples:
  # Start a new project
  arc init "Build a REST API for a todo app"
  
  # Add tasks WITH verification (enables Ralph loop)
  arc add "Set up Express server" --verify "curl -s localhost:3000/health"
  arc add "Create Todo CRUD API" --verify "bun test src/todo.test.ts"
  arc add "Add JWT authentication" --verify "curl -s -H 'Authorization: Bearer test' localhost:3000/me"
  
  # Add task without verification (will need manual review)
  arc add "Write API documentation"
  
  # Run one iteration
  arc iterate
  
  # Keep going until done
  arc go
  
  # Check progress
  arc status

Philosophy:
  Plan a little, build a little, learn, repeat.
  The plan evolves with each iteration.
  Rapid cycles over big upfront design.

Architecture:
  Arc (orchestration, iteration loop)
    → Agent (Codex, Claude Code, OpenCode, Pi)
      → LLM (Claude, GPT, Gemini, etc.)
`

type AgentType = "codex" | "claude-code" | "opencode" | "pi"
type Command = "init" | "iterate" | "go" | "add" | "status" | "backlog" | "insights" | "plan" | "run" | "help"

interface Args {
  command: Command
  goal?: string                // For init
  taskDescription?: string     // For add
  acceptanceCriteria?: string  // For add --verify
  why?: string                 // For add --why
  size?: "small" | "medium" | "large"  // For add --size
  insertTop?: boolean          // For add --top
  planFile?: string            // For run (legacy)
  loadFile?: string            // For plan (legacy)
  crankMode: boolean
  maxAttempts: number
  agent: AgentType
  provider?: string
  model?: string
  autoApprove: boolean
  projectFile?: string
}

const parseArgs = (argv: string[]): Args => {
  const args: Args = {
    command: "help",
    crankMode: false,
    maxAttempts: 5,
    agent: "claude-code",
    autoApprove: false,
  }

  let i = 0
  while (i < argv.length) {
    const arg = argv[i]

    switch (arg) {
      case "init":
        args.command = "init"
        // Next arg should be the goal
        if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
          args.goal = argv[++i]
        }
        break
      case "iterate":
        args.command = "iterate"
        break
      case "go":
        args.command = "go"
        break
      case "add":
        args.command = "add"
        // Next arg should be the task description
        if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
          args.taskDescription = argv[++i]
        }
        break
      case "--verify":
      case "-v":
        args.acceptanceCriteria = argv[++i]
        break
      case "--why":
        args.why = argv[++i]
        break
      case "--size":
        const sizeArg = argv[++i]?.toLowerCase()
        if (sizeArg && ["small", "medium", "large"].includes(sizeArg)) {
          args.size = sizeArg as "small" | "medium" | "large"
        }
        break
      case "--top":
        args.insertTop = true
        break
      case "status":
        args.command = "status"
        break
      case "backlog":
        args.command = "backlog"
        break
      case "insights":
        args.command = "insights"
        break
      case "plan":
        args.command = "plan"
        break
      case "run":
        args.command = "run"
        if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
          args.planFile = argv[++i]
        }
        break
      case "--help":
      case "-h":
        args.command = "help"
        break
      case "--crank":
      case "-c":
        args.crankMode = true
        break
      case "--max-attempts":
      case "-m":
        args.maxAttempts = parseInt(argv[++i] || "5")
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
      case "--project":
      case "-p":
        args.projectFile = argv[++i]
        break
      case "--load":
      case "-l":
        args.loadFile = argv[++i]
        break
      default:
        // Check for positional args
        if (!arg.startsWith("-") && args.command === "help") {
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

    case "init": {
      if (!args.goal) {
        console.error("Error: Goal required")
        console.error('Usage: arc init "Your project goal"')
        process.exit(1)
      }
      const { runInitCommand } = await import("./commands/init")
      await Effect.runPromise(runInitCommand(args.goal, {
        projectFile: args.projectFile,
      }))
      break
    }

    case "iterate": {
      const { runIterateCommand } = await import("./commands/iterate")
      await Effect.runPromise(runIterateCommand({
        agent: args.agent,
        maxAttempts: args.maxAttempts,
        provider: args.provider,
        model: args.model,
        autoApprove: args.autoApprove,
        projectFile: args.projectFile,
      }))
      break
    }

    case "go": {
      const { runGoCommand } = await import("./commands/go")
      await Effect.runPromise(runGoCommand({
        agent: args.agent,
        maxAttempts: args.maxAttempts,
        provider: args.provider,
        model: args.model,
        autoApprove: args.autoApprove,
        projectFile: args.projectFile,
      }))
      break
    }

    case "add": {
      if (!args.taskDescription) {
        console.error("Error: Task description required")
        console.error('Usage: arc add "Your task description" [--verify "command"]')
        process.exit(1)
      }
      const { runAddCommand } = await import("./commands/add")
      await Effect.runPromise(runAddCommand(args.taskDescription, {
        projectFile: args.projectFile,
        acceptanceCriteria: args.acceptanceCriteria,
        why: args.why,
        size: args.size,
        top: args.insertTop,
      }))
      break
    }

    case "status": {
      const { runStatusCommand } = await import("./commands/status")
      await Effect.runPromise(runStatusCommand({
        projectFile: args.projectFile,
      }))
      break
    }

    case "backlog": {
      const { runBacklogCommand } = await import("./commands/backlog")
      await Effect.runPromise(runBacklogCommand({
        projectFile: args.projectFile,
      }))
      break
    }

    case "insights": {
      const { runInsightsCommand } = await import("./commands/insights")
      await Effect.runPromise(runInsightsCommand({
        projectFile: args.projectFile,
      }))
      break
    }

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
          maxIterations: args.maxAttempts,
          maxNoChange: 3,
          maxTotal: 50,
          agent: args.agent,
          provider: args.provider,
          model: args.model,
          autoApprove: args.autoApprove,
        })
      )
      break
    }
  }
}

main().catch((e) => {
  console.error("Fatal error:", e.message || e)
  process.exit(1)
})
