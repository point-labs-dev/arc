import { readAttributeString } from "./attributes"
import type { GraphDefinition, GraphNode } from "./types"

export type ModelStylesheetProperty = "llm_model" | "llm_provider" | "reasoning_effort"

export type ModelStylesheetSelector =
  | {
      readonly type: "all"
    }
  | {
      readonly type: "id"
      readonly value: string
    }
  | {
      readonly type: "class"
      readonly value: string
    }

export interface ModelStylesheetRule {
  readonly selector: ModelStylesheetSelector
  readonly declarations: Partial<Record<ModelStylesheetProperty, string>>
  readonly order: number
}

const STYLESHEET_PROPERTIES: readonly ModelStylesheetProperty[] = [
  "llm_model",
  "llm_provider",
  "reasoning_effort",
]

const VALID_STYLESHEET_PROPERTIES = new Set<ModelStylesheetProperty>(STYLESHEET_PROPERTIES)
const CLASS_PATTERN = /^[a-z0-9-]+$/

export const parseModelStylesheet = (stylesheet: string): ModelStylesheetRule[] => {
  const text = stylesheet.trim()
  if (text.length === 0) {
    return []
  }

  let index = 0
  let parsedRuleCount = 0
  const parsedRules: ModelStylesheetRule[] = []

  while (index < text.length) {
    index = skipWhitespace(text, index)
    if (index >= text.length) {
      break
    }

    const selector = parseSelector(text, index)
    index = skipWhitespace(text, selector.nextIndex)
    if (text[index] !== "{") {
      throw new Error("Expected '{' after selector")
    }
    index += 1

    let declarationCount = 0
    const declarations: Partial<Record<ModelStylesheetProperty, string>> = {}

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
      if (!VALID_STYLESHEET_PROPERTIES.has(property.value as ModelStylesheetProperty)) {
        throw new Error(`Unknown stylesheet property "${property.value}"`)
      }

      index = skipWhitespace(text, index)
      if (text[index] !== ":") {
        throw new Error(`Expected ':' after "${property.value}"`)
      }
      index += 1
      index = skipWhitespace(text, index)

      const valueResult = readStylesheetValue(text, index)
      const resolvedProperty = property.value as ModelStylesheetProperty
      if (resolvedProperty === "reasoning_effort") {
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

      declarations[resolvedProperty] = valueResult.value
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

    parsedRules.push({
      selector: selector.selector,
      declarations,
      order: parsedRuleCount,
    })

    parsedRuleCount += 1
  }

  if (parsedRuleCount === 0) {
    throw new Error("Stylesheet must contain at least one rule")
  }

  return parsedRules
}

export const applyModelStylesheet = (graph: GraphDefinition): void => {
  const stylesheet = readAttributeString(graph.attrs, "model_stylesheet").trim()
  if (stylesheet.length === 0) {
    return
  }

  const parsed = parseModelStylesheet(stylesheet)
  if (parsed.length === 0) {
    return
  }

  for (const node of graph.nodes) {
    applyResolvedDeclarations(node, parsed)
  }
}

const applyResolvedDeclarations = (node: GraphNode, rules: readonly ModelStylesheetRule[]): void => {
  const resolved = resolveDeclarations(node, rules)

  for (const property of STYLESHEET_PROPERTIES) {
    if (isPropertyExplicitOnNode(node, property)) {
      continue
    }

    const value = resolved[property]
    if (value !== undefined) {
      node.attrs[property] = value
    }
  }
}

const resolveDeclarations = (
  node: GraphNode,
  rules: readonly ModelStylesheetRule[],
): Partial<Record<ModelStylesheetProperty, string>> => {
  const resolved: Partial<
    Record<
      ModelStylesheetProperty,
      {
        readonly value: string
        readonly specificity: number
        readonly order: number
      }
    >
  > = {}

  for (const rule of rules) {
    if (!selectorMatchesNode(rule.selector, node)) {
      continue
    }

    const specificity = selectorSpecificity(rule.selector)
    for (const property of STYLESHEET_PROPERTIES) {
      const nextValue = rule.declarations[property]
      if (nextValue === undefined) {
        continue
      }

      const previous = resolved[property]
      if (
        previous !== undefined &&
        (previous.specificity > specificity ||
          (previous.specificity === specificity && previous.order > rule.order))
      ) {
        continue
      }

      resolved[property] = {
        value: nextValue,
        specificity,
        order: rule.order,
      }
    }
  }

  const output: Partial<Record<ModelStylesheetProperty, string>> = {}
  for (const property of STYLESHEET_PROPERTIES) {
    const candidate = resolved[property]
    if (candidate !== undefined) {
      output[property] = candidate.value
    }
  }

  return output
}

const selectorMatchesNode = (selector: ModelStylesheetSelector, node: GraphNode): boolean => {
  if (selector.type === "all") {
    return true
  }

  if (selector.type === "id") {
    return node.id === selector.value
  }

  const classes = new Set(
    readAttributeString(node.attrs, "class")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  )
  return classes.has(selector.value)
}

const selectorSpecificity = (selector: ModelStylesheetSelector): number => {
  if (selector.type === "all") {
    return 0
  }
  if (selector.type === "class") {
    return 1
  }
  return 2
}

const isPropertyExplicitOnNode = (
  node: GraphNode,
  property: ModelStylesheetProperty,
): boolean => {
  if (node.explicitAttrs !== undefined) {
    return node.explicitAttrs.includes(property)
  }

  return readAttributeString(node.attrs, property).trim().length > 0
}

const skipWhitespace = (value: string, start: number): number => {
  let index = start
  while (index < value.length && /\s/.test(value[index])) {
    index += 1
  }
  return index
}

const parseSelector = (
  value: string,
  start: number,
): {
  readonly selector: ModelStylesheetSelector
  readonly nextIndex: number
} => {
  const first = value[start]
  if (first === "*") {
    return {
      selector: { type: "all" },
      nextIndex: start + 1,
    }
  }

  if (first === "#") {
    const result = readIdentifier(value, start + 1, "Expected identifier after '#'.")
    return {
      selector: {
        type: "id",
        value: result.value,
      },
      nextIndex: result.nextIndex,
    }
  }

  if (first === ".") {
    const result = readUntilDelimiter(value, start + 1)
    if (!CLASS_PATTERN.test(result.value)) {
      throw new Error(`Invalid class selector ".${result.value}"`)
    }

    return {
      selector: {
        type: "class",
        value: result.value,
      },
      nextIndex: result.nextIndex,
    }
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
