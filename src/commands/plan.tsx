/**
 * Plan Command
 * 
 * Interactive planning UI to build a plan collaboratively with an AI agent.
 * Uses Ink (React for CLI) for a rich terminal experience.
 */

import { Effect } from "effect"
import { render, Box, Text, useInput, useApp } from "ink"
import TextInput from "ink-text-input"
import Spinner from "ink-spinner"
import React, { useState, useCallback } from "react"
import { createPlan, addStep, type Plan, type Step } from "../types/plan"
import { LLMService, LLMServiceLive, type Message } from "../llm/service"
import * as fs from "fs"

// === Types ===

interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

// === Planning Agent ===

const PLANNING_SYSTEM_PROMPT = `You are a planning assistant helping create a detailed execution plan for a coding task.

Your job is to:
1. Understand what the user wants to build
2. Ask clarifying questions if needed
3. Break down the work into clear, verifiable steps
4. Each step should be atomic and testable

When the plan is ready, output it in this format:
\`\`\`plan
STEP: <description>
VERIFY: <verification command or "manual">

STEP: <description>
VERIFY: <verification command or "manual">
\`\`\`

Guidelines:
- Each step should be completable in one iteration
- Include testing/verification for each step
- Consider edge cases and error handling
- Think about the order of operations

Ask clarifying questions before creating the plan. Once you understand the requirements, create the plan.`

// === Components ===

interface PlanAppProps {
  loadFile?: string
  onComplete: (plan: Plan) => void
}

const PlanApp: React.FC<PlanAppProps> = ({ loadFile, onComplete }) => {
  const { exit } = useApp()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [mode, setMode] = useState<"chat" | "review" | "edit">("chat")

  // Load existing plan
  React.useEffect(() => {
    if (loadFile && fs.existsSync(loadFile)) {
      try {
        const content = fs.readFileSync(loadFile, "utf-8")
        const loaded = JSON.parse(content) as Plan
        setPlan(loaded)
        setMode("review")
      } catch (e) {
        // Ignore load errors
      }
    }
  }, [loadFile])

  const sendMessage = useCallback(async (userMessage: string) => {
    if (!userMessage.trim()) return

    const newMessages: ChatMessage[] = [...messages, { role: "user", content: userMessage }]
    setMessages(newMessages)
    setInput("")
    setIsLoading(true)

    try {
      // Build conversation for LLM
      const llmMessages: Message[] = [
        { role: "system", content: PLANNING_SYSTEM_PROMPT },
        ...newMessages.map((m) => ({ role: m.role, content: m.content })),
      ]

      // Call LLM (simplified - in real implementation use Effect properly)
      const response = await callLLM(llmMessages)

      setMessages([...newMessages, { role: "assistant", content: response }])

      // Check if response contains a plan
      const extractedPlan = extractPlan(response, userMessage)
      if (extractedPlan) {
        setPlan(extractedPlan)
        setMode("review")
      }
    } catch (e) {
      setMessages([
        ...newMessages,
        { role: "assistant", content: `Error: ${e instanceof Error ? e.message : "Unknown error"}` },
      ])
    } finally {
      setIsLoading(false)
    }
  }, [messages])

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === "c") {
      exit()
    }
    if (key.return && !isLoading && mode === "chat") {
      sendMessage(input)
    }
    if (mode === "review") {
      if (inputChar === "y" || inputChar === "Y") {
        // Accept plan
        if (plan) {
          onComplete(plan)
          exit()
        }
      } else if (inputChar === "e" || inputChar === "E") {
        // Edit plan
        setMode("edit")
      } else if (inputChar === "n" || inputChar === "N") {
        // Reject and continue chatting
        setMode("chat")
        setMessages([
          ...messages,
          { role: "assistant", content: "Let's refine the plan. What would you like to change?" },
        ])
      }
    }
  })

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="magenta">🎯 Ralph Planning</Text>
        <Text color="gray"> - Build your execution plan</Text>
      </Box>

      {/* Chat Messages */}
      <Box flexDirection="column" marginBottom={1}>
        {messages.slice(-10).map((msg, i) => (
          <Box key={i} marginBottom={1}>
            <Text color={msg.role === "user" ? "cyan" : "green"}>
              {msg.role === "user" ? "You: " : "Ralph: "}
            </Text>
            <Text>{msg.content.slice(0, 500)}{msg.content.length > 500 ? "..." : ""}</Text>
          </Box>
        ))}
      </Box>

      {/* Loading Indicator */}
      {isLoading && (
        <Box marginBottom={1}>
          <Spinner type="dots" />
          <Text color="yellow"> Thinking...</Text>
        </Box>
      )}

      {/* Mode-specific UI */}
      {mode === "chat" && (
        <Box>
          <Text color="cyan">{">"} </Text>
          <TextInput
            value={input}
            onChange={setInput}
            placeholder="Describe what you want to build..."
          />
        </Box>
      )}

      {mode === "review" && plan && (
        <Box flexDirection="column">
          <Text bold color="yellow">📋 Plan Ready: {plan.name}</Text>
          <Box marginTop={1} flexDirection="column">
            {plan.steps.map((step, i) => (
              <Text key={step.id} color="white">
                {i + 1}. {step.description}
              </Text>
            ))}
          </Box>
          <Box marginTop={1}>
            <Text color="gray">[Y]es to accept, [E]dit to modify, [N]o to continue refining</Text>
          </Box>
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="gray">Ctrl+C to exit • Enter to send</Text>
      </Box>
    </Box>
  )
}

// === Helpers ===

const callLLM = async (messages: Message[]): Promise<string> => {
  // Simplified LLM call - in production, use Effect properly
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY required")
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.RALPH_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: messages.find((m) => m.role === "system")?.content,
      messages: messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content })),
    }),
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }

  const data = await response.json() as { content: Array<{ text: string }> }
  return data.content[0]?.text || ""
}

const extractPlan = (response: string, description: string): Plan | null => {
  // Look for plan block in response
  const planMatch = response.match(/```plan\n([\s\S]*?)```/)
  if (!planMatch) return null

  const planContent = planMatch[1]
  const stepMatches = planContent.matchAll(/STEP:\s*(.+)\nVERIFY:\s*(.+)/g)

  const steps: Step[] = []
  let i = 1
  for (const match of stepMatches) {
    const [, desc, verify] = match
    steps.push({
      id: `step-${i++}`,
      description: desc.trim(),
      verification: verify.trim().toLowerCase() === "manual"
        ? { type: "manual" }
        : { type: "exit_code_0", command: verify.trim() },
      status: "pending",
    })
  }

  if (steps.length === 0) return null

  return {
    id: crypto.randomUUID(),
    name: description.slice(0, 50),
    description,
    context: {},
    steps,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    status: "ready",
  }
}

// === Command ===

export const runPlanCommand = (loadFile?: string): Effect.Effect<void> =>
  Effect.async((resume) => {
    const onComplete = (plan: Plan) => {
      // Save plan to file
      const filename = `plan-${Date.now()}.json`
      fs.writeFileSync(filename, JSON.stringify(plan, null, 2))
      console.log(`\n✅ Plan saved to ${filename}`)
      console.log(`\nTo execute: ralph run ${filename}`)
      console.log(`Hand-crank:  ralph run ${filename} --crank`)
      resume(Effect.succeed(undefined))
    }

    render(React.createElement(PlanApp, { loadFile, onComplete }))
  })
