import {
  type AttributeValue,
  type Diagnostic,
  type GraphDefinition,
  KNOWN_HANDLER_TYPES,
  type LintRule,
  SHAPE_TO_HANDLER,
  VALID_FIDELITY_MODES,
  ValidationError,
} from "./types"

export interface ParsedConditionClause {
  readonly key: string
  readonly operator: "=" | "!="
  readonly literal: string | number | boolean
}

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const CONTEXT_KEY_PATTERN = /^context\.[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/

export const validate = (graph: GraphDefinition, extraRules: LintRule[] = []): Diagnostic[] => {
  const rules = [...BUILT_IN_RULES, ...extraRules]
  const diagnostics: Diagnostic[] = []
  for (const rule of rules) {
    diagnostics.push(...rule.apply(graph))
  }
  return diagnostics
}

export const validateOrRaise = (
  graph: GraphDefinition,
  extraRules: LintRule[] = [],
): Diagnostic[] => {
  const diagnostics = validate(graph, extraRules)
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "ERROR")
  if (errors.length > 0) {
    throw new ValidationError(errors)
  }
  return diagnostics
}

export const parseConditionExpression = (condition: string): ParsedConditionClause[] => {
  const trimmed = condition.trim()
  if (trimmed.length === 0) {
    return []
  }

  const clauses = splitByAnd(trimmed)
  return clauses.map((clause) => parseConditionClause(clause))
}

export const validateStylesheetSyntax = (stylesheet: string): void => {
  const text = stylesheet.trim()
  if (text.length === 0) {
    return
  }

  let index = 0
  let parsedRuleCount = 0
  while (index < text.length) {
    index = skipWhitespace(text, index)
    if (index >= text.length) {
      break
    }

    index = parseSelector(text, index)
    index = skipWhitespace(text, index)
    if (text[index] !== "{") {
      throw new Error("Expected '{' after selector")
    }
    index += 1

    let declarationCount = 0
    while (true) {
      index = skipWhitespace(text, index)
      if (index >= text.length) {
        throw new Error("Unterminated stylesheet rule")
      }
      if (text[index] === "}") {
        index += 1
        break
      }

      const property = readIdentifier(text, index, "Expected property name")
      index = property.nextIndex
      if (!VALID_STYLESHEET_PROPERTIES.has(property.value)) {
        throw new Error(`Unknown stylesheet property "${property.value}"`)
      }

      index = skipWhitespace(text, index)
      if (text[index] !== ":") {
        throw new Error(`Expected ':' after "${property.value}"`)
      }
      index += 1
      index = skipWhitespace(text, index)

      const valueResult = readStylesheetValue(text, index)
      if (property.value === "reasoning_effort") {
        if (
          valueResult.value !== "low" &&
          valueResult.value !== "medium" &&
          valueResult.value !== "high"
        ) {
          throw new Error(
            'reasoning_effort must be one of "low", "medium", or "high" in the stylesheet',
          )
        }
      }
      index = valueResult.nextIndex
      declarationCount += 1

      index = skipWhitespace(text, index)
      if (index >= text.length) {
        throw new Error("Unterminated stylesheet rule")
      }

      if (text[index] === ";") {
        index += 1
        continue
      }
      if (text[index] === "}") {
        continue
      }
      throw new Error("Expected ';' or '}' after stylesheet declaration")
    }

    if (declarationCount === 0) {
      throw new Error("Stylesheet rule must contain at least one declaration")
    }
    parsedRuleCount += 1
  }

  if (parsedRuleCount === 0) {
    throw new Error("Stylesheet must contain at least one rule")
  }
}

const BUILT_IN_RULES: LintRule[] = [
  {
    name: "start_node",
    apply: (graph) => {
      const starts = findStartNodes(graph)
      if (starts.length === 1) {
        return []
      }
      return [
        {
          rule: "start_node",
          severity: "ERROR",
          message: `Pipeline must have exactly one start node; found ${starts.length}.`,
          fix: 'Ensure exactly one node is shape="Mdiamond" or has ID "start".',
        },
      ]
    },
  },
  {
    name: "terminal_node",
    apply: (graph) => {
      const terminals = findTerminalNodes(graph)
      if (terminals.length > 0) {
        return []
      }
      return [
        {
          rule: "terminal_node",
          severity: "ERROR",
          message: "Pipeline must have at least one terminal node.",
          fix: 'Add a node with shape="Msquare" or an ID of "exit"/"end".',
        },
      ]
    },
  },
  {
    name: "edge_target_exists",
    apply: (graph) => {
      const nodeIds = new Set(graph.nodes.map((node) => node.id))
      const diagnostics: Diagnostic[] = []
      for (const edge of graph.edges) {
        if (!nodeIds.has(edge.from)) {
          diagnostics.push({
            rule: "edge_target_exists",
            severity: "ERROR",
            message: `Edge source "${edge.from}" does not reference an existing node.`,
            edge: [edge.from, edge.to],
          })
        }
        if (!nodeIds.has(edge.to)) {
          diagnostics.push({
            rule: "edge_target_exists",
            severity: "ERROR",
            message: `Edge target "${edge.to}" does not reference an existing node.`,
            edge: [edge.from, edge.to],
          })
        }
      }
      return diagnostics
    },
  },
  {
    name: "start_no_incoming",
    apply: (graph) => {
      const starts = findStartNodes(graph)
      if (starts.length !== 1) {
        return []
      }
      const start = starts[0]
      const incoming = graph.edges.filter((edge) => edge.to === start.id)
      if (incoming.length === 0) {
        return []
      }
      return [
        {
          rule: "start_no_incoming",
          severity: "ERROR",
          message: `Start node "${start.id}" must have no incoming edges.`,
          node_id: start.id,
        },
      ]
    },
  },
  {
    name: "exit_no_outgoing",
    apply: (graph) => {
      const terminals = findTerminalNodes(graph)
      const diagnostics: Diagnostic[] = []
      for (const terminal of terminals) {
        const outgoing = graph.edges.filter((edge) => edge.from === terminal.id)
        if (outgoing.length > 0) {
          diagnostics.push({
            rule: "exit_no_outgoing",
            severity: "ERROR",
            message: `Terminal node "${terminal.id}" must have no outgoing edges.`,
            node_id: terminal.id,
          })
        }
      }
      return diagnostics
    },
  },
  {
    name: "reachability",
    apply: (graph) => {
      const starts = findStartNodes(graph)
      if (starts.length !== 1) {
        return []
      }

      const nodeIds = new Set(graph.nodes.map((node) => node.id))
      const visited = new Set<string>()
      const queue: string[] = [starts[0].id]

      while (queue.length > 0) {
        const current = queue.shift()
        if (current === undefined || visited.has(current)) {
          continue
        }
        visited.add(current)

        const outgoing = graph.edges.filter((edge) => edge.from === current)
        for (const edge of outgoing) {
          if (nodeIds.has(edge.to) && !visited.has(edge.to)) {
            queue.push(edge.to)
          }
        }
      }

      const diagnostics: Diagnostic[] = []
      for (const node of graph.nodes) {
        if (!visited.has(node.id)) {
          diagnostics.push({
            rule: "reachability",
            severity: "ERROR",
            message: `Node "${node.id}" is unreachable from start node "${starts[0].id}".`,
            node_id: node.id,
          })
        }
      }
      return diagnostics
    },
  },
  {
    name: "condition_syntax",
    apply: (graph) => {
      const diagnostics: Diagnostic[] = []
      for (const edge of graph.edges) {
        const condition = attributeString(edge.attrs.condition).trim()
        if (condition.length === 0) {
          continue
        }

        try {
          parseConditionExpression(condition)
        } catch (error) {
          const message = error instanceof Error ? error.message : "Invalid condition syntax."
          diagnostics.push({
            rule: "condition_syntax",
            severity: "ERROR",
            message: `Invalid condition on edge ${edge.from} -> ${edge.to}: ${message}`,
            edge: [edge.from, edge.to],
          })
        }
      }
      return diagnostics
    },
  },
  {
    name: "stylesheet_syntax",
    apply: (graph) => {
      const stylesheet = attributeString(graph.attrs.model_stylesheet).trim()
      if (stylesheet.length === 0) {
        return []
      }
      try {
        validateStylesheetSyntax(stylesheet)
        return []
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid stylesheet syntax."
        return [
          {
            rule: "stylesheet_syntax",
            severity: "ERROR",
            message: `model_stylesheet is invalid: ${message}`,
            fix: "Provide valid stylesheet rules per Section 8.2 grammar.",
          },
        ]
      }
    },
  },
  {
    name: "type_known",
    apply: (graph) => {
      const diagnostics: Diagnostic[] = []
      for (const node of graph.nodes) {
        const type = attributeString(node.attrs.type).trim()
        if (type.length > 0 && !KNOWN_HANDLER_TYPES.has(type)) {
          diagnostics.push({
            rule: "type_known",
            severity: "WARNING",
            message: `Unknown node type "${type}" on node "${node.id}".`,
            node_id: node.id,
          })
        }
      }
      return diagnostics
    },
  },
  {
    name: "fidelity_valid",
    apply: (graph) => {
      const diagnostics: Diagnostic[] = []

      const graphFidelity = attributeString(graph.attrs.default_fidelity).trim()
      if (graphFidelity.length > 0 && !VALID_FIDELITY_MODES.has(graphFidelity)) {
        diagnostics.push({
          rule: "fidelity_valid",
          severity: "WARNING",
          message: `Graph default_fidelity "${graphFidelity}" is not a recognized fidelity mode.`,
        })
      }

      for (const node of graph.nodes) {
        const nodeFidelity = attributeString(node.attrs.fidelity).trim()
        if (nodeFidelity.length > 0 && !VALID_FIDELITY_MODES.has(nodeFidelity)) {
          diagnostics.push({
            rule: "fidelity_valid",
            severity: "WARNING",
            message: `Node "${node.id}" uses invalid fidelity "${nodeFidelity}".`,
            node_id: node.id,
          })
        }
      }

      for (const edge of graph.edges) {
        const edgeFidelity = attributeString(edge.attrs.fidelity).trim()
        if (edgeFidelity.length > 0 && !VALID_FIDELITY_MODES.has(edgeFidelity)) {
          diagnostics.push({
            rule: "fidelity_valid",
            severity: "WARNING",
            message: `Edge ${edge.from} -> ${edge.to} uses invalid fidelity "${edgeFidelity}".`,
            edge: [edge.from, edge.to],
          })
        }
      }

      return diagnostics
    },
  },
  {
    name: "retry_target_exists",
    apply: (graph) => {
      const nodeIds = new Set(graph.nodes.map((node) => node.id))
      const diagnostics: Diagnostic[] = []

      const graphRetryTarget = attributeString(graph.attrs.retry_target).trim()
      const graphFallbackRetryTarget = attributeString(graph.attrs.fallback_retry_target).trim()

      if (graphRetryTarget.length > 0 && !nodeIds.has(graphRetryTarget)) {
        diagnostics.push({
          rule: "retry_target_exists",
          severity: "WARNING",
          message: `Graph retry_target "${graphRetryTarget}" does not exist.`,
        })
      }
      if (graphFallbackRetryTarget.length > 0 && !nodeIds.has(graphFallbackRetryTarget)) {
        diagnostics.push({
          rule: "retry_target_exists",
          severity: "WARNING",
          message: `Graph fallback_retry_target "${graphFallbackRetryTarget}" does not exist.`,
        })
      }

      for (const node of graph.nodes) {
        const retryTarget = attributeString(node.attrs.retry_target).trim()
        const fallbackRetryTarget = attributeString(node.attrs.fallback_retry_target).trim()
        if (retryTarget.length > 0 && !nodeIds.has(retryTarget)) {
          diagnostics.push({
            rule: "retry_target_exists",
            severity: "WARNING",
            message: `Node "${node.id}" retry_target "${retryTarget}" does not exist.`,
            node_id: node.id,
          })
        }
        if (fallbackRetryTarget.length > 0 && !nodeIds.has(fallbackRetryTarget)) {
          diagnostics.push({
            rule: "retry_target_exists",
            severity: "WARNING",
            message: `Node "${node.id}" fallback_retry_target "${fallbackRetryTarget}" does not exist.`,
            node_id: node.id,
          })
        }
      }

      return diagnostics
    },
  },
  {
    name: "goal_gate_has_retry",
    apply: (graph) => {
      const diagnostics: Diagnostic[] = []
      for (const node of graph.nodes) {
        const isGoalGate = attributeBoolean(node.attrs.goal_gate)
        if (!isGoalGate) {
          continue
        }

        const retryTarget = attributeString(node.attrs.retry_target).trim()
        const fallbackRetryTarget = attributeString(node.attrs.fallback_retry_target).trim()
        if (retryTarget.length === 0 && fallbackRetryTarget.length === 0) {
          diagnostics.push({
            rule: "goal_gate_has_retry",
            severity: "WARNING",
            message: `Goal-gated node "${node.id}" should define retry_target or fallback_retry_target.`,
            node_id: node.id,
          })
        }
      }
      return diagnostics
    },
  },
  {
    name: "prompt_on_llm_nodes",
    apply: (graph) => {
      const diagnostics: Diagnostic[] = []
      for (const node of graph.nodes) {
        const resolvedType = resolveNodeType(node.attrs)
        if (resolvedType !== "codergen") {
          continue
        }

        const prompt = attributeString(node.attrs.prompt).trim()
        const label = attributeString(node.attrs.label).trim()
        if (prompt.length === 0 && (label.length === 0 || label === node.id)) {
          diagnostics.push({
            rule: "prompt_on_llm_nodes",
            severity: "WARNING",
            message: `Codergen node "${node.id}" should define a meaningful prompt or label.`,
            node_id: node.id,
          })
        }
      }
      return diagnostics
    },
  },
]

const findStartNodes = (graph: GraphDefinition) =>
  graph.nodes.filter((node) => {
    const shape = attributeString(node.attrs.shape).trim()
    return shape === "Mdiamond" || node.id.toLowerCase() === "start"
  })

const findTerminalNodes = (graph: GraphDefinition) =>
  graph.nodes.filter((node) => {
    const shape = attributeString(node.attrs.shape).trim()
    const normalizedId = node.id.toLowerCase()
    return shape === "Msquare" || normalizedId === "exit" || normalizedId === "end"
  })

const resolveNodeType = (attrs: Record<string, AttributeValue>): string => {
  const explicitType = attributeString(attrs.type).trim()
  if (explicitType.length > 0) {
    return explicitType
  }
  const shape = attributeString(attrs.shape).trim()
  return SHAPE_TO_HANDLER[shape] ?? "codergen"
}

const attributeString = (value: AttributeValue | undefined): string => {
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "number") {
    return String(value)
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }
  if (value === undefined) {
    return ""
  }
  return value.raw
}

const attributeBoolean = (value: AttributeValue | undefined): boolean => {
  if (typeof value === "boolean") {
    return value
  }
  if (typeof value === "string") {
    return value === "true"
  }
  return false
}

const splitByAnd = (value: string): string[] => {
  const clauses: string[] = []
  let current = ""
  let insideString = false
  let escaped = false

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]

    if (insideString) {
      current += char
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (char === '"') {
        insideString = false
      }
      continue
    }

    if (char === '"') {
      insideString = true
      current += char
      continue
    }

    if (char === "&" && value[index + 1] === "&") {
      if (current.trim().length === 0) {
        throw new Error("Condition contains an empty clause around &&")
      }
      clauses.push(current.trim())
      current = ""
      index += 1
      continue
    }

    current += char
  }

  if (insideString) {
    throw new Error("Unterminated string literal in condition")
  }
  if (current.trim().length === 0) {
    throw new Error("Condition cannot end with &&")
  }
  clauses.push(current.trim())
  return clauses
}

const parseConditionClause = (clause: string): ParsedConditionClause => {
  const operatorIndex = findOperatorOutsideString(clause)
  if (operatorIndex < 0) {
    throw new Error(`Clause "${clause}" must contain "=" or "!="`)
  }

  const isNotEquals = clause.slice(operatorIndex, operatorIndex + 2) === "!="
  const operator: "=" | "!=" = isNotEquals ? "!=" : "="
  const rightStart = operatorIndex + (isNotEquals ? 2 : 1)

  const key = clause.slice(0, operatorIndex).trim()
  const literalText = clause.slice(rightStart).trim()
  if (key.length === 0 || literalText.length === 0) {
    throw new Error(`Invalid clause "${clause}"`)
  }
  if (!isValidConditionKey(key)) {
    throw new Error(`Unsupported condition key "${key}"`)
  }

  return {
    key,
    operator,
    literal: parseConditionLiteral(literalText),
  }
}

const findOperatorOutsideString = (clause: string): number => {
  let insideString = false
  let escaped = false

  for (let index = 0; index < clause.length; index += 1) {
    const char = clause[index]
    if (insideString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (char === '"') {
        insideString = false
      }
      continue
    }

    if (char === '"') {
      insideString = true
      continue
    }

    if (char === "!" && clause[index + 1] === "=") {
      return index
    }
    if (char === "=") {
      return index
    }
  }
  return -1
}

const isValidConditionKey = (key: string): boolean =>
  key === "outcome" || key === "preferred_label" || CONTEXT_KEY_PATTERN.test(key)

const parseConditionLiteral = (literal: string): string | number | boolean => {
  if (literal.startsWith('"')) {
    if (!literal.endsWith('"') || literal.length === 1) {
      throw new Error(`Unterminated string literal in clause value "${literal}"`)
    }
    return parseQuotedLiteral(literal)
  }

  if (/^-?\d+$/.test(literal)) {
    return Number.parseInt(literal, 10)
  }
  if (literal === "true") {
    return true
  }
  if (literal === "false") {
    return false
  }
  if (!IDENTIFIER_PATTERN.test(literal)) {
    throw new Error(`Invalid literal "${literal}"`)
  }
  return literal
}

const parseQuotedLiteral = (literal: string): string => {
  let result = ""
  for (let index = 1; index < literal.length - 1; index += 1) {
    const char = literal[index]
    if (char !== "\\") {
      result += char
      continue
    }

    const escaped = literal[index + 1]
    if (escaped === undefined) {
      throw new Error("Unterminated escape sequence in condition string literal")
    }
    if (escaped === '"' || escaped === "\\") {
      result += escaped
      index += 1
      continue
    }
    if (escaped === "n") {
      result += "\n"
      index += 1
      continue
    }
    if (escaped === "t") {
      result += "\t"
      index += 1
      continue
    }
    throw new Error(`Unsupported escape sequence "\\${escaped}" in condition string literal`)
  }
  return result
}

const VALID_STYLESHEET_PROPERTIES = new Set(["llm_model", "llm_provider", "reasoning_effort"])
const CLASS_PATTERN = /^[a-z0-9-]+$/

const skipWhitespace = (value: string, start: number): number => {
  let index = start
  while (index < value.length && /\s/.test(value[index])) {
    index += 1
  }
  return index
}

const parseSelector = (value: string, start: number): number => {
  const first = value[start]
  if (first === "*") {
    return start + 1
  }
  if (first === "#") {
    const result = readIdentifier(value, start + 1, "Expected identifier after '#'.")
    return result.nextIndex
  }
  if (first === ".") {
    const result = readUntilDelimiter(value, start + 1)
    if (!CLASS_PATTERN.test(result.value)) {
      throw new Error(`Invalid class selector ".${result.value}"`)
    }
    return result.nextIndex
  }
  throw new Error(`Invalid selector starting at "${value.slice(start, start + 10)}"`)
}

const readIdentifier = (
  value: string,
  start: number,
  errorMessage: string,
): { value: string; nextIndex: number } => {
  if (start >= value.length || !/[A-Za-z_]/.test(value[start])) {
    throw new Error(errorMessage)
  }

  let index = start + 1
  while (index < value.length && /[A-Za-z0-9_]/.test(value[index])) {
    index += 1
  }
  return {
    value: value.slice(start, index),
    nextIndex: index,
  }
}

const readUntilDelimiter = (value: string, start: number): { value: string; nextIndex: number } => {
  let index = start
  while (index < value.length && !/\s|\{|\}|;|:/.test(value[index])) {
    index += 1
  }
  if (index === start) {
    throw new Error("Expected value")
  }
  return {
    value: value.slice(start, index),
    nextIndex: index,
  }
}

const readStylesheetValue = (
  value: string,
  start: number,
): { value: string; nextIndex: number } => {
  if (value[start] === '"') {
    let index = start + 1
    let escaped = false
    while (index < value.length) {
      const char = value[index]
      if (escaped) {
        escaped = false
        index += 1
        continue
      }
      if (char === "\\") {
        escaped = true
        index += 1
        continue
      }
      if (char === '"') {
        return {
          value: value.slice(start + 1, index),
          nextIndex: index + 1,
        }
      }
      index += 1
    }
    throw new Error("Unterminated quoted value in stylesheet")
  }

  return readUntilDelimiter(value, start)
}
