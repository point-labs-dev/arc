# Arc Engine — Build Instructions

## What You're Building

A DOT-based pipeline runner based on the Attractor specification. This is the core engine for Arc, a software factory that orchestrates AI coding agents.

## Key Reference

The full Attractor specification is at `../../reference/attractor-spec.md`. **Read it thoroughly before starting.** It contains:
- DOT DSL schema (BNF grammar, node/edge attributes, shape-to-handler mapping)
- Pipeline execution engine (core loop, edge selection, goal gates, retry logic)
- Node handlers (start, exit, codergen, wait.human, conditional, parallel, fan-in, tool, manager loop)
- State and context (Context store, Outcome, Checkpoint)
- Human-in-the-loop (Interviewer pattern)
- Validation and linting rules
- Model stylesheet (CSS-like per-node configuration)
- Transforms and extensibility
- Condition expression language
- Definition of done

## What to Implement

Implement the Attractor spec as a TypeScript library. Key adaptations from the original spec:

### Scope for v1

**MUST implement:**
1. **DOT parser** — Parse the DOT subset defined in Section 2 (BNF grammar). Produce an in-memory Graph model (nodes, edges, attributes with typed values).
2. **Pipeline execution engine** — The core loop from Section 3.2. Edge selection (Section 3.3). Goal gate enforcement (Section 3.4). Retry logic (Section 3.5-3.6). Failure routing (Section 3.7).
3. **Node handlers** — All handlers from Section 4:
   - `start` (no-op entry)
   - `exit` (no-op exit)
   - `codergen` (LLM task via CodergenBackend interface)
   - `wait.human` (human gate via Interviewer interface)
   - `conditional` (routing node)
   - `parallel` (fan-out with join policies)
   - `parallel.fan_in` (consolidate parallel results)
   - `tool` (external command execution)
4. **State and context** — Context store (Section 5.1), Outcome (Section 5.2), Checkpoint serialization (Section 5.3).
5. **Condition expression language** — Section 10. Simple expressions like `outcome=success`, `outcome!=fail`, `satisfaction>=0.8`.
6. **Validation/linting** — Section 7. Exactly one start, one exit, reachability, no orphans.
7. **Event system** — Section 9.6. Typed events for every pipeline action. EventEmitter interface.
8. **Checkpoint and resume** — Save state after each node. Resume from checkpoint on restart.

**SHOULD implement:**
- Model stylesheet (Section 8) — CSS-like per-node model/provider defaults
- Variable expansion ($goal in prompts)
- Subgraphs for scoping defaults

**DEFER (not v1):**
- Manager loop handler (Section 4.11) — complex supervisor pattern, add later
- Transforms (Section 9) — extensibility hooks, add when needed

### Architecture

```
src/
├── parser/
│   ├── lexer.ts          # Tokenize DOT source
│   ├── parser.ts         # Parse tokens into Graph AST
│   └── types.ts          # Graph, Node, Edge, Attribute types
├── engine/
│   ├── engine.ts         # Core execution loop (Section 3.2)
│   ├── edge-selection.ts # Edge selection algorithm (Section 3.3)
│   ├── retry.ts          # Retry policies (Section 3.5-3.6)
│   ├── checkpoint.ts     # Checkpoint save/resume (Section 5.3)
│   └── goal-gates.ts     # Goal gate enforcement (Section 3.4)
├── handlers/
│   ├── handler.ts        # Handler interface + registry
│   ├── start.ts          # Start handler
│   ├── exit.ts           # Exit handler
│   ├── codergen.ts       # LLM task handler (CodergenBackend interface)
│   ├── conditional.ts    # Conditional routing
│   ├── parallel.ts       # Parallel fan-out
│   ├── fan-in.ts         # Parallel fan-in
│   ├── tool.ts           # External tool execution
│   └── wait-human.ts     # Human-in-the-loop gate
├── context/
│   ├── context.ts        # Thread-safe key-value Context (Section 5.1)
│   ├── outcome.ts        # Outcome type (Section 5.2)
│   └── conditions.ts     # Condition expression evaluator (Section 10)
├── events/
│   ├── events.ts         # Event types
│   └── emitter.ts        # EventEmitter interface
├── validation/
│   └── lint.ts           # Graph validation rules (Section 7)
├── stylesheet/
│   └── stylesheet.ts     # Model stylesheet parser/applier (Section 8)
└── index.ts              # Public API exports
```

### Key Interfaces (the integration points)

```typescript
// The backend that does the actual LLM work.
// Pi will implement this. But the engine doesn't know about Pi.
interface CodergenBackend {
  run(node: Node, prompt: string, context: Context): Promise<string | Outcome>;
}

// The frontend for human-in-the-loop.
// Discord/CLI/Web UI will implement this.
interface Interviewer {
  ask(question: Question): Promise<Answer>;
}

// The event consumer.
// Monitoring UI, Discord, logs will implement this.
interface EventListener {
  onEvent(event: PipelineEvent): void;
}
```

### What the Engine Does NOT Do

- **No LLM calls.** The engine calls `CodergenBackend.run()`. What happens inside is not its concern.
- **No Pi dependency.** The engine is backend-agnostic. Pi is one implementation of CodergenBackend.
- **No Discord/UI.** The engine emits events. Consumers decide how to present them.
- **No file system access** (except checkpoint serialization). Tool execution is done by the `tool` handler via shell commands.

## Verification

After implementation, these must pass:

1. **`npm run typecheck`** — zero errors
2. **`npm run test`** — all tests pass
3. **`npm run lint`** — zero errors
4. **Parse test:** Parse all example DOT files from Section 2.13 of the spec
5. **Execution test:** Run a simple linear pipeline (Start → Task → Exit) with a mock CodergenBackend
6. **Branching test:** Run a branching pipeline with conditions (Section 2.13 example 2)
7. **Human gate test:** Run a pipeline that pauses at a hexagon node and resumes on answer
8. **Retry test:** Pipeline retries a failing node up to max_retries
9. **Goal gate test:** Pipeline refuses to exit when a goal gate hasn't been satisfied
10. **Checkpoint test:** Save checkpoint, kill process, resume from checkpoint, complete pipeline
11. **Parallel test:** Fan-out to 2 branches, both execute, fan-in selects best

## Effect.ts Usage

This project uses **Effect** (`effect` package) as its core runtime. Effect provides typed errors, structured concurrency, resource management, retry policies, and dependency injection via Services/Layers.

### Conventions

- **Use `Effect.gen` (generators)** for business logic with conditionals and sequencing. Prefer generators over pipe chains for readability.
- **Use `pipe()` chains** for one-way data transformation pipelines.
- **Tagged errors** for all failure types: `class ParseError extends Data.TaggedError("ParseError")<{ message: string }> {}`
- **Services for integration points**: `CodergenBackend`, `Interviewer`, `EventListener` are Effect Services with `Context.Tag`. Implementations provided via Layers.
- **`Effect.acquireRelease`** for any resource that needs cleanup (Pi RPC subprocesses, file handles, checkpoint locks).
- **`Schedule`** for retry policies — map Attractor's retry spec to `Schedule.exponential`, `Schedule.jittered`, `Schedule.upTo`.
- **`Ref<Context>`** for the pipeline's shared context store (thread-safe mutable reference).
- **`Effect.all` with concurrency options** for parallel fan-out. Use `{ concurrency: N }` for bounded parallelism.
- **`Fiber.interrupt`** for abort/cancellation — propagates through the entire fiber tree.
- **`Effect.timeout`** for per-node timeouts.
- **Namespace imports** for tree shaking: `import * as Effect from "effect/Effect"`, `import * as Schedule from "effect/Schedule"`.

### Mapping Attractor Concepts to Effect

| Attractor | Effect |
|-----------|--------|
| Retry with backoff + jitter (Section 3.5-3.6) | `Effect.retry(Schedule.exponential("200 millis").pipe(Schedule.jittered, Schedule.upTo(maxRetries)))` |
| Parallel fan-out (Section 4.8) | `Effect.all(branches, { concurrency: maxParallel })` |
| fail_fast join policy | `Effect.raceAll(branches)` or custom with `Fiber.interrupt` |
| Context store (Section 5.1) | `Ref<Map<string, unknown>>` with `Ref.update` |
| Checkpoint save (Section 5.3) | `Effect.acquireRelease(save, cleanup)` |
| Abort signal | `Fiber.interrupt` on the root fiber |
| Handler registry (Section 4.2) | `Layer` composition — each handler is a Service implementation |
| Event emission (Section 9.6) | `SubscriptionRef` or `Queue` for event distribution |
| Timeout (node attribute) | `Effect.timeout(Duration.decode(node.timeout))` |
| Goal gate check (Section 3.4) | `Effect.filterOrFail` |

### Example: Core execution loop in Effect

```typescript
const executeNode = (node: Node) =>
  Effect.gen(function* () {
    const registry = yield* HandlerRegistry
    const context = yield* PipelineContext
    const events = yield* EventEmitter

    const handler = registry.resolve(node)
    yield* events.emit({ type: "node_start", nodeId: node.id })

    const outcome = yield* handler
      .execute(node, context)
      .pipe(
        Effect.retry(buildRetrySchedule(node)),
        Effect.timeout(Duration.decode(node.timeout ?? "15m")),
        Effect.catchTag("TimeoutError", () =>
          Effect.succeed(Outcome.fail("Node timed out"))
        )
      )

    yield* events.emit({ type: "node_end", nodeId: node.id, outcome })
    return outcome
  })
```

## Code Style

- TypeScript strict mode
- ES modules (import/export)
- Effect.gen (generators) for business logic, pipe() for data transforms
- Tagged errors for all failure types (Data.TaggedError)
- Services + Layers for dependency injection
- No `any` types — use `unknown` and narrow
- Tests co-located: `src/parser/parser.test.ts` next to `src/parser/parser.ts`
- Use vitest for testing
- Namespace imports: `import * as Effect from "effect/Effect"`
- **Linting:** oxlint (fast, Rust-based) — NOT eslint
- **Formatting:** Biome (fast, Rust-based) — NOT prettier
- Run `npm run check` to validate: `biome check && oxlint && tsc --noEmit`
