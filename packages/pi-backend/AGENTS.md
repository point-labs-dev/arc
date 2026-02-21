# Pi Backend — Build Instructions

## What You're Building

An implementation of `@point-labs/arc-engine`'s `CodergenBackend` interface that spawns Pi coding agent sessions via RPC.

## How Pi RPC Works

Pi runs as a subprocess:
```bash
pi --mode rpc --provider anthropic --model claude-sonnet-4-20250514 --no-session
```

Communication is JSON-over-stdin/stdout (one JSON object per line):

**Sending commands (write to stdin):**
```json
{"type": "prompt", "message": "Implement the auth endpoint"}
{"type": "steer", "message": "Tests failed, fix the validation"}
{"type": "follow_up", "message": "Now add error handling"}
{"type": "abort"}
{"type": "get_state"}
```

**Receiving events (read from stdout, one per line):**
```json
{"type": "tool_execution_start", "toolName": "edit_file", "input": {...}}
{"type": "tool_execution_end", "isError": false}
{"type": "message_update", "assistantMessageEvent": {"type": "text_delta", "delta": "..."}}
{"type": "message_end"}
{"type": "state", "state": {"tokenUsage": {...}, "model": "..."}}
```

## Implementation

```typescript
import { CodergenBackend, Node, Context, Outcome } from '@point-labs/arc-engine';

class PiRpcBackend implements CodergenBackend {
  async run(node: Node, prompt: string, context: Context): Promise<string | Outcome> {
    // 1. Spawn: pi --mode rpc --provider <from node attrs> --model <from node attrs> --no-session
    // 2. Write: {"type":"prompt","message":"<prompt>"}\n
    // 3. Read stdout line by line, parse JSON events
    // 4. Emit events (tool_execution_start/end, text_delta, etc.)
    // 5. On message_end: collect full response text
    // 6. Return response text or Outcome based on content
  }
}
```

**Key behaviors:**
- Each `run()` call spawns a FRESH Pi process (fresh context per attempt)
- Events from Pi are mapped to Arc pipeline events
- On abort: write `{"type":"abort"}` to stdin, then kill process
- Timeout: configurable per node via `timeout` attribute
- Model/provider: read from node's `llm_model` and `llm_provider` attributes

## Verification

1. **Mock test:** Spawn a fake "Pi" process that echoes events, verify the backend handles them
2. **Integration test** (optional, requires Pi installed): Run a trivial task through a real Pi session
