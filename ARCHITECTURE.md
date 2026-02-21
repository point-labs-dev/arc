# Arc Architecture — Option B: OpenClaw + Pi SDK

*Spec v0.1 — 2026-02-16*

## Overview

Arc is the **coding orchestrator** for Point Labs. It lives inside OpenClaw as an extension/skill and uses **Pi's SDK** programmatically to execute coding tasks — replacing raw PTY spawning with structured, event-driven agent sessions.

OpenClaw handles the **what** (task planning, backlog, verification, learning). Pi handles the **how** (LLM interaction, tool execution, file editing, bash).

## Architecture Diagram

```mermaid
graph TB
    subgraph User["👤 User"]
        Discord["Discord / iMessage / CLI"]
    end

    subgraph OC["OpenClaw Gateway"]
        Main["Main Session (Ceph)"]
        ArcSkill["Arc Skill"]
        
        subgraph ArcCore["Arc Orchestrator"]
            Planner["Planner"]
            Backlog["Backlog Manager"]
            Verifier["Verifier"]
            Learner["Learner"]
            Loop["Ralph Loop Controller"]
        end
    end

    subgraph PiSDK["Pi SDK (embedded)"]
        SessionFactory["createAgentSession()"]
        
        subgraph Sessions["Agent Sessions"]
            S1["Session A (task 1)"]
            S2["Session B (task 2)"]
            S3["Session C (task 3)"]
        end
        
        Events["Event Stream"]
        Auth["AuthStorage + ModelRegistry"]
    end

    subgraph Providers["LLM Providers"]
        Anthropic["Anthropic (Claude)"]
        OpenAI["OpenAI (Codex/GPT)"]
        Google["Google (Gemini)"]
        Other["OpenRouter / Ollama / ..."]
    end

    subgraph Project["Project Workspace"]
        Git["Git Repo"]
        PM["PROJECT.md"]
        BL["BACKLOG.md"]
        LN["LEARNINGS.md"]
    end

    Discord --> Main
    Main --> ArcSkill
    ArcSkill --> Planner
    Planner --> Backlog
    Backlog --> Loop

    Loop --> SessionFactory
    SessionFactory --> S1
    SessionFactory --> S2
    SessionFactory --> S3

    S1 & S2 & S3 --> Events
    Events --> Verifier
    Verifier -->|pass| Learner
    Verifier -->|fail| Loop
    Learner --> Backlog

    Auth --> Anthropic & OpenAI & Google & Other

    S1 & S2 & S3 --> Git
    Planner --> PM & BL
    Learner --> LN & BL

    style ArcCore fill:#1a1a2e,stroke:#e94560,color:#fff
    style PiSDK fill:#0f3460,stroke:#16213e,color:#fff
    style Sessions fill:#16213e,stroke:#0f3460,color:#fff
```

## Component Breakdown

### 1. Arc Skill (OpenClaw layer)

Lives at `skills/arc/` in OpenClaw. Activated when Peter says "let's iterate" or explicitly invokes Arc.

**Responsibilities:**
- Parse PROJECT.md, BACKLOG.md, LEARNINGS.md
- Plan tasks and prioritize
- Decide sequential vs parallel execution
- Verify task completion
- Capture learnings
- Report progress to user

**Does NOT:** Write code, run bash, edit files in the project. That's Pi's job.

### 2. Arc Orchestrator (the brain)

```
┌─────────────────────────────────────────────┐
│                 Arc Orchestrator              │
│                                               │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │ Planner  │→│ Loop Ctrl │→│  Verifier   │ │
│  └──────────┘  └──────────┘  └────────────┘ │
│       ↕              ↕              ↕         │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │ Backlog  │  │ Pi SDK   │  │  Learner   │ │
│  │ Manager  │  │ Bridge   │  │            │ │
│  └──────────┘  └──────────┘  └────────────┘ │
└─────────────────────────────────────────────┘
```

**Planner** — Reads project files, generates tasks with verification criteria.

**Backlog Manager** — CRUD on BACKLOG.md. Tracks task status, priorities, dependencies.

**Loop Controller (Ralph Loop)** — The iteration engine:
```
pick task → create Pi session → prompt → stream events → verify → learn → repeat
```

**Verifier** — Runs verification commands (tests, type-check, lint) and evaluates results against task criteria.

**Learner** — Extracts insights from successes/failures, updates LEARNINGS.md, feeds context back into future tasks.

### 3. Pi SDK Bridge

The integration layer between Arc and Pi's SDK.

```typescript
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";

interface ArcPiBridge {
  // Create a fresh session for a task
  createTaskSession(options: {
    workdir: string;
    model?: string;
    agentsMd?: string;       // injected project context
    extensions?: string[];    // Pi extensions to load
  }): Promise<TaskSession>;
}

interface TaskSession {
  // Execute a task prompt, returns structured result
  execute(prompt: string): Promise<TaskResult>;
  
  // Steer mid-execution
  steer(instruction: string): Promise<void>;
  
  // Stream events for progress monitoring
  onEvent(handler: (event: TaskEvent) => void): void;
  
  // Clean up
  dispose(): void;
}

interface TaskResult {
  success: boolean;
  filesChanged: string[];
  output: string;            // structured, not raw terminal text
  tokensUsed: number;
  model: string;
  duration: number;
}
```

**Key advantage over PTY:** Structured `TaskResult` instead of parsing terminal output. Events for real-time progress. Clean session lifecycle.

### 4. Auth Flow

Pi's `AuthStorage` + `ModelRegistry` handle provider auth. Arc doesn't touch tokens directly.

```mermaid
graph LR
    Arc["Arc Orchestrator"] --> Bridge["Pi SDK Bridge"]
    Bridge --> Auth["AuthStorage"]
    Auth -->|"OAuth"| CC["Claude Code Token"]
    Auth -->|"OAuth"| Codex["Codex Token"]
    Auth -->|"API Key"| Keys["~/.pi/auth/"]
    Auth --> MR["ModelRegistry"]
    MR --> Provider["Selected Provider"]
```

Pi already supports Claude Code OAuth and Codex OAuth — Arc gets this for free through the SDK. No custom auth code needed.

### 5. Parallel Execution

```mermaid
graph TB
    Loop["Ralph Loop"] --> Check{"Independent tasks?"}
    Check -->|"yes"| Parallel["Parallel Executor"]
    Check -->|"no"| Sequential["Sequential Executor"]
    
    Parallel --> WT1["git worktree A"]
    Parallel --> WT2["git worktree B"]
    Parallel --> WT3["git worktree C"]
    
    WT1 --> PS1["Pi Session 1"]
    WT2 --> PS2["Pi Session 2"]
    WT3 --> PS3["Pi Session 3"]
    
    PS1 & PS2 & PS3 --> Merge["Verify + Merge"]
    
    Sequential --> WT["workdir"]
    WT --> PS["Pi Session"]
    PS --> Verify["Verify"]
    Verify -->|"fail"| WT
    Verify -->|"pass"| Next["Next Task"]
```

Each parallel task gets:
- Its own **git worktree** (file isolation)
- Its own **Pi AgentSession** (context isolation)
- Its own **event stream** (independent monitoring)

Arc monitors all streams, merges results, handles conflicts.

## Data Flow: Single Task Lifecycle

```mermaid
sequenceDiagram
    participant U as User
    participant A as Arc Orchestrator
    participant B as Pi SDK Bridge
    participant P as Pi AgentSession
    participant G as Git/Filesystem

    U->>A: "Iterate on the API"
    A->>A: Read PROJECT.md, BACKLOG.md
    A->>A: Pick top task + verification criteria
    
    A->>B: createTaskSession({ workdir, model })
    B->>P: createAgentSession({ ... })
    B-->>A: taskSession
    
    A->>B: execute(taskPrompt)
    B->>P: session.prompt(taskPrompt)
    
    loop Streaming
        P-->>B: event (text_delta, tool_execution, ...)
        B-->>A: TaskEvent (progress update)
        A-->>U: "Working on endpoint... editing routes.ts"
    end
    
    P->>G: File edits, bash commands
    P-->>B: message_end
    B-->>A: TaskResult { success, filesChanged, output }
    
    A->>A: Run verification (tests, typecheck)
    
    alt Verification passes
        A->>A: Update BACKLOG.md (task complete)
        A->>A: Update LEARNINGS.md
        A-->>U: "✅ Task done: added /api/users endpoint"
    else Verification fails
        A->>A: Capture failure context
        A->>B: execute(retryPrompt + failureContext)
        Note over A,P: Loop until pass or circuit break
    end
```

## File Structure

```
skills/arc/
├── SKILL.md              # OpenClaw skill definition
├── src/
│   ├── index.ts          # Skill entry point
│   ├── orchestrator.ts   # Arc core logic
│   ├── planner.ts        # Task planning
│   ├── backlog.ts        # BACKLOG.md parser/writer
│   ├── verifier.ts       # Verification engine
│   ├── learner.ts        # Learning extraction
│   ├── loop.ts           # Ralph loop controller
│   └── bridge/
│       ├── pi-bridge.ts  # Pi SDK integration
│       ├── session.ts    # TaskSession wrapper
│       └── events.ts     # Event mapping
├── extensions/
│   └── arc-context.ts    # Pi extension: injects project context
└── templates/
    └── task-prompt.md    # Prompt template for coding tasks
```

## Configuration

```yaml
# arc.config.yaml (per-project)
model: claude-sonnet-4-20250514       # default model for coding tasks
thinkingLevel: medium
maxRetries: 3                    # circuit breaker per task
maxParallel: 3                   # concurrent Pi sessions
verification:
  commands:
    - "npm run typecheck"
    - "npm run test"
    - "npm run lint"
  timeout: 60                    # seconds per verification
auth:
  prefer: oauth                  # oauth | apikey
  provider: anthropic            # default provider
```

## Why This Over PTY Spawning

| Aspect | PTY (current) | Pi SDK (Option B) |
|--------|--------------|-------------------|
| Output | Raw terminal text, ANSI codes | Structured events + typed results |
| Control | `process:write` / `send-keys` | `session.steer()` / `session.followUp()` |
| Lifecycle | Kill PID, hope for the best | `session.dispose()`, clean shutdown |
| Progress | Parse terminal output | Event stream with typed events |
| Auth | Separate per-agent | Unified via Pi's AuthStorage |
| Models | Fixed per agent | Switch mid-session, cycle providers |
| Context | AGENTS.md only | Extensions can inject dynamic context |
| Parallel | Multiple PTY processes | Multiple AgentSessions, same process |
| Error handling | Exit codes + output parsing | Structured error events |

## Open Questions

1. **Where does Arc live?** OpenClaw skill? Standalone package? Both?
2. **Pi extension vs pure SDK?** Should Arc also ship a Pi extension for standalone use (Option A hybrid)?
3. **Session persistence** — In-memory sessions (fresh per task) or file-backed (resume on crash)?
4. **Model selection** — Should Arc pick the model per-task based on complexity? (e.g., Haiku for lint fixes, Opus for architecture)
5. **OAuth token sharing** — Pi can use CC/Codex OAuth tokens. Should we auto-discover them or require explicit config?

---

*Next steps: Validate this spec, then start with a minimal loop — one task, one Pi session, verify, learn.*
