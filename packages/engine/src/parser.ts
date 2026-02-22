import {
  type AttributeMap,
  type AttributeType,
  type AttributeValue,
  type DurationUnit,
  type DurationValue,
  EDGE_ATTR_TYPES,
  EDGE_DEFAULTS,
  GRAPH_ATTR_TYPES,
  GRAPH_DEFAULTS,
  type GraphDefinition,
  type GraphEdge,
  type GraphNode,
  NODE_ATTR_TYPES,
  NODE_DEFAULTS,
  ParseError,
} from "./types"

type TokenKind = "identifier" | "string" | "number" | "duration" | "boolean" | "symbol" | "eof"

interface Token {
  readonly kind: TokenKind
  readonly value: string
  readonly line: number
  readonly column: number
}

interface ParseScope {
  nodeDefaults: AttributeMap
  edgeDefaults: AttributeMap
  inheritedClasses: string[]
  localLabel?: string
  topLevel: boolean
}

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const DURATION_PATTERN = /^(-?\d+)(ms|s|m|h|d)$/
const FLOAT_PATTERN = /^-?(?:\d+\.\d+|\d+)$/

export const parseDot = (source: string): GraphDefinition => new DotParser(source).parse()

class DotParser {
  private readonly tokens: Token[]
  private index = 0

  private graphId = ""
  private graphAttrs: AttributeMap = { ...GRAPH_DEFAULTS }
  private readonly nodeOrder: string[] = []
  private readonly nodesById = new Map<string, GraphNode>()
  private readonly edges: GraphEdge[] = []

  constructor(source: string) {
    this.tokens = tokenize(source)
  }

  parse(): GraphDefinition {
    const first = this.peek()
    if (first.kind === "identifier" && first.value === "strict") {
      throw this.errorAt(first, "Only digraph graphs are supported; strict is not allowed")
    }

    this.expectIdentifierValue("digraph")
    const graphIdToken = this.expectKind("identifier", "Expected graph identifier after digraph")
    this.graphId = graphIdToken.value
    this.expectSymbol("{")

    const rootScope: ParseScope = {
      nodeDefaults: { ...NODE_DEFAULTS },
      edgeDefaults: { ...EDGE_DEFAULTS },
      inheritedClasses: [],
      topLevel: true,
    }

    this.parseStatementList(rootScope)
    this.expectSymbol("}")
    this.consumeSemicolons()

    if (this.peek().kind !== "eof") {
      throw this.errorHere("Only one digraph per file is allowed")
    }

    return {
      id: this.graphId,
      attrs: this.graphAttrs,
      nodes: this.nodeOrder
        .map((nodeId) => this.nodesById.get(nodeId))
        .filter((node): node is GraphNode => node !== undefined),
      edges: this.edges,
    }
  }

  private parseStatementList(scope: ParseScope): Set<string> {
    const touchedNodeIds = new Set<string>()

    while (!this.checkSymbol("}")) {
      if (this.peek().kind === "eof") {
        throw this.errorHere("Unterminated graph or subgraph block")
      }

      const statementTouched = this.parseStatement(scope)
      for (const nodeId of statementTouched) {
        touchedNodeIds.add(nodeId)
      }
      this.consumeSemicolons()
    }

    return touchedNodeIds
  }

  private parseStatement(scope: ParseScope): string[] {
    const token = this.peek()
    if (token.kind !== "identifier") {
      throw this.errorAt(token, `Unexpected token "${token.value}"`)
    }

    if (token.value === "graph") {
      this.advance()
      this.parseGraphAttrStmt(scope)
      return []
    }

    if (token.value === "node") {
      this.advance()
      this.parseNodeDefaults(scope)
      return []
    }

    if (token.value === "edge") {
      this.advance()
      this.parseEdgeDefaults(scope)
      return []
    }

    if (token.value === "subgraph") {
      this.advance()
      return this.parseSubgraph(scope)
    }

    const lookahead = this.peek(1)
    if (lookahead.kind === "symbol" && lookahead.value === "=") {
      this.parseGraphAttrDecl(scope)
      return []
    }

    if (lookahead.kind === "symbol" && (lookahead.value === "->" || lookahead.value === "--")) {
      this.parseEdgeStmt(scope)
      return []
    }

    const nodeId = this.parseNodeStmt(scope)
    return [nodeId]
  }

  private parseGraphAttrStmt(scope: ParseScope): void {
    const attrs = this.parseAttrBlock(GRAPH_ATTR_TYPES)
    if (scope.topLevel) {
      this.graphAttrs = { ...this.graphAttrs, ...attrs }
      return
    }

    const label = attrs.label
    if (typeof label === "string") {
      scope.localLabel = label
    }
  }

  private parseNodeDefaults(scope: ParseScope): void {
    const defaults = this.parseAttrBlock(NODE_ATTR_TYPES)
    scope.nodeDefaults = { ...scope.nodeDefaults, ...defaults }
  }

  private parseEdgeDefaults(scope: ParseScope): void {
    const defaults = this.parseAttrBlock(EDGE_ATTR_TYPES)
    scope.edgeDefaults = { ...scope.edgeDefaults, ...defaults }
  }

  private parseGraphAttrDecl(scope: ParseScope): void {
    const keyToken = this.expectKind("identifier", "Expected attribute key")
    this.expectSymbol("=")
    const rawValue = this.parseValue()
    const value = coerceAttributeValue(
      keyToken.value,
      rawValue,
      GRAPH_ATTR_TYPES[keyToken.value],
      this.errorAt.bind(this),
    )

    if (scope.topLevel) {
      this.graphAttrs = {
        ...this.graphAttrs,
        [keyToken.value]: value,
      }
      return
    }

    if (keyToken.value === "label") {
      scope.localLabel = attributeToString(value)
    }
  }

  private parseNodeStmt(scope: ParseScope): string {
    const nodeId = this.expectKind("identifier", "Expected node identifier").value
    const explicitAttrs = this.checkSymbol("[") ? this.parseAttrBlock(NODE_ATTR_TYPES) : {}

    const mergedAttrs: AttributeMap = {
      ...scope.nodeDefaults,
      ...explicitAttrs,
    }

    if (typeof mergedAttrs.label !== "string" || mergedAttrs.label.length === 0) {
      mergedAttrs.label = nodeId
    }

    mergedAttrs.class = mergeClasses(
      typeof mergedAttrs.class === "string" ? mergedAttrs.class : "",
      scope.inheritedClasses,
    )

    this.upsertNode(nodeId, mergedAttrs)
    return nodeId
  }

  private parseEdgeStmt(scope: ParseScope): void {
    const points: string[] = [
      this.expectKind("identifier", "Expected edge source identifier").value,
    ]

    while (this.checkSymbol("->") || this.checkSymbol("--")) {
      const operator = this.expectKind("symbol", "Expected edge operator")
      if (operator.value === "--") {
        throw this.errorAt(operator, "Undirected edges (--) are not supported; use ->")
      }
      const target = this.expectKind("identifier", "Expected edge target identifier")
      points.push(target.value)
    }

    if (points.length < 2) {
      throw this.errorHere("Edge statement must include at least one target")
    }

    const explicitAttrs = this.checkSymbol("[") ? this.parseAttrBlock(EDGE_ATTR_TYPES) : {}
    const edgeAttrs = { ...scope.edgeDefaults, ...explicitAttrs }

    for (let index = 0; index < points.length - 1; index += 1) {
      this.edges.push({
        from: points[index],
        to: points[index + 1],
        attrs: { ...edgeAttrs },
      })
    }
  }

  private parseSubgraph(scope: ParseScope): string[] {
    if (this.peek().kind === "identifier") {
      this.advance()
    }

    this.expectSymbol("{")
    const childScope: ParseScope = {
      nodeDefaults: { ...scope.nodeDefaults },
      edgeDefaults: { ...scope.edgeDefaults },
      inheritedClasses: [...scope.inheritedClasses],
      topLevel: false,
    }

    const touchedNodeIds = this.parseStatementList(childScope)
    this.expectSymbol("}")

    if (childScope.localLabel !== undefined && childScope.localLabel.trim().length > 0) {
      const derivedClass = deriveSubgraphClass(childScope.localLabel)
      if (derivedClass.length > 0) {
        for (const nodeId of touchedNodeIds) {
          const node = this.nodesById.get(nodeId)
          if (node === undefined) {
            continue
          }
          node.attrs.class = mergeClasses(
            typeof node.attrs.class === "string" ? node.attrs.class : "",
            [derivedClass],
          )
        }
      }
    }

    return Array.from(touchedNodeIds)
  }

  private parseAttrBlock(typeMap: Record<string, AttributeType>): AttributeMap {
    this.expectSymbol("[")
    const attrs: AttributeMap = {}

    if (this.checkSymbol("]")) {
      throw this.errorHere("Attribute blocks must contain at least one key=value pair")
    }

    while (true) {
      const key = this.parseQualifiedKey()
      this.expectSymbol("=")
      const rawValue = this.parseValue()
      attrs[key] = coerceAttributeValue(key, rawValue, typeMap[key], this.errorAt.bind(this))

      if (this.checkSymbol(",")) {
        this.advance()
        continue
      }
      if (this.checkSymbol("]")) {
        this.advance()
        break
      }

      throw this.errorHere(
        "Expected ',' or ']' in attribute block; attributes must be comma-separated",
      )
    }

    return attrs
  }

  private parseQualifiedKey(): string {
    const first = this.expectKind("identifier", "Expected attribute key")
    let key = first.value
    while (this.checkSymbol(".")) {
      this.advance()
      const part = this.expectKind("identifier", "Expected identifier after '.' in attribute key")
      key = `${key}.${part.value}`
    }
    return key
  }

  private parseValue(): AttributeValue {
    const token = this.peek()

    if (token.kind === "string") {
      this.advance()
      return token.value
    }
    if (token.kind === "boolean") {
      this.advance()
      return token.value === "true"
    }
    if (token.kind === "duration") {
      this.advance()
      return parseDuration(token.value, this.errorAt.bind(this), token)
    }
    if (token.kind === "number") {
      this.advance()
      return Number(token.value)
    }
    if (token.kind === "identifier") {
      this.advance()
      return token.value
    }

    throw this.errorAt(token, `Expected value, found "${token.value}"`)
  }

  private upsertNode(nodeId: string, attrs: AttributeMap): void {
    const existing = this.nodesById.get(nodeId)
    if (existing !== undefined) {
      existing.attrs = {
        ...existing.attrs,
        ...attrs,
      }
      return
    }

    this.nodeOrder.push(nodeId)
    this.nodesById.set(nodeId, {
      id: nodeId,
      attrs,
    })
  }

  private consumeSemicolons(): void {
    while (this.checkSymbol(";")) {
      this.advance()
    }
  }

  private checkSymbol(symbol: string): boolean {
    const token = this.peek()
    return token.kind === "symbol" && token.value === symbol
  }

  private expectSymbol(symbol: string): void {
    const token = this.peek()
    if (token.kind !== "symbol" || token.value !== symbol) {
      throw this.errorAt(token, `Expected "${symbol}"`)
    }
    this.advance()
  }

  private expectIdentifierValue(value: string): void {
    const token = this.peek()
    if (token.kind !== "identifier" || token.value !== value) {
      throw this.errorAt(token, `Expected "${value}"`)
    }
    this.advance()
  }

  private expectKind<TKind extends TokenKind>(kind: TKind, message: string): Token {
    const token = this.peek()
    if (token.kind !== kind) {
      throw this.errorAt(token, message)
    }
    this.advance()
    return token
  }

  private peek(offset = 0): Token {
    const token = this.tokens[this.index + offset]
    return token ?? this.tokens[this.tokens.length - 1]
  }

  private advance(): Token {
    const token = this.peek()
    this.index += 1
    return token
  }

  private errorHere(message: string): ParseError {
    const token = this.peek()
    return new ParseError(message, token.line, token.column)
  }

  private errorAt(token: Token, message: string): ParseError {
    return new ParseError(message, token.line, token.column)
  }
}

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = []
  const length = source.length

  let index = 0
  let line = 1
  let column = 1

  const current = (): string => source[index] ?? ""
  const next = (): string => source[index + 1] ?? ""

  const advance = (count = 1): void => {
    for (let step = 0; step < count; step += 1) {
      if (source[index] === "\n") {
        line += 1
        column = 1
      } else {
        column += 1
      }
      index += 1
    }
  }

  const add = (kind: TokenKind, value: string, tokenLine: number, tokenColumn: number): void => {
    tokens.push({
      kind,
      value,
      line: tokenLine,
      column: tokenColumn,
    })
  }

  while (index < length) {
    const char = current()

    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      advance()
      continue
    }

    if (char === "/" && next() === "/") {
      advance(2)
      while (index < length && current() !== "\n") {
        advance()
      }
      continue
    }

    if (char === "/" && next() === "*") {
      const commentLine = line
      const commentColumn = column
      advance(2)
      let closed = false
      while (index < length) {
        if (current() === "*" && next() === "/") {
          advance(2)
          closed = true
          break
        }
        advance()
      }
      if (!closed) {
        throw new ParseError("Unterminated block comment", commentLine, commentColumn)
      }
      continue
    }

    const tokenLine = line
    const tokenColumn = column

    if (char === '"' && index < length) {
      const parsedString = readQuotedString(source, index, tokenLine, tokenColumn)
      add("string", parsedString.value, tokenLine, tokenColumn)
      index = parsedString.nextIndex
      line = parsedString.nextLine
      column = parsedString.nextColumn
      continue
    }

    if (char === "-" && next() === ">") {
      add("symbol", "->", tokenLine, tokenColumn)
      advance(2)
      continue
    }

    if (char === "-" && next() === "-") {
      add("symbol", "--", tokenLine, tokenColumn)
      advance(2)
      continue
    }

    if ("{}[]=,;.".includes(char)) {
      add("symbol", char, tokenLine, tokenColumn)
      advance()
      continue
    }

    if (isIdentifierStart(char)) {
      let value = ""
      while (isIdentifierPart(current())) {
        value += current()
        advance()
      }
      if (value === "true" || value === "false") {
        add("boolean", value, tokenLine, tokenColumn)
      } else {
        add("identifier", value, tokenLine, tokenColumn)
      }
      continue
    }

    if (char === "-" || isDigit(char)) {
      const rest = source.slice(index)

      const durationMatch = rest.match(/^-?\d+(ms|s|m|h|d)(?![A-Za-z0-9_])/)
      if (durationMatch !== null) {
        add("duration", durationMatch[0], tokenLine, tokenColumn)
        advance(durationMatch[0].length)
        continue
      }

      const numberMatch = rest.match(/^-?(?:\d+\.\d+|\d+)(?![A-Za-z0-9_])/)
      if (numberMatch !== null) {
        add("number", numberMatch[0], tokenLine, tokenColumn)
        advance(numberMatch[0].length)
        continue
      }
    }

    throw new ParseError(`Unexpected character "${char}"`, tokenLine, tokenColumn)
  }

  tokens.push({
    kind: "eof",
    value: "",
    line,
    column,
  })

  return tokens
}

const readQuotedString = (
  source: string,
  startIndex: number,
  startLine: number,
  startColumn: number,
): { value: string; nextIndex: number; nextLine: number; nextColumn: number } => {
  let index = startIndex + 1
  let line = startLine
  let column = startColumn + 1
  let value = ""

  while (index < source.length) {
    const char = source[index]
    if (char === '"') {
      return {
        value,
        nextIndex: index + 1,
        nextLine: line,
        nextColumn: column + 1,
      }
    }

    if (char === "\\") {
      const escaped = source[index + 1]
      if (escaped === undefined) {
        throw new ParseError("Unterminated escape sequence in string", line, column)
      }
      if (escaped === '"') {
        value += '"'
      } else if (escaped === "n") {
        value += "\n"
      } else if (escaped === "t") {
        value += "\t"
      } else if (escaped === "\\") {
        value += "\\"
      } else {
        throw new ParseError(`Unsupported escape sequence \\${escaped}`, line, column)
      }
      index += 2
      column += 2
      continue
    }

    if (char === "\n") {
      value += char
      index += 1
      line += 1
      column = 1
      continue
    }

    value += char
    index += 1
    column += 1
  }

  throw new ParseError("Unterminated string literal", startLine, startColumn)
}

const coerceAttributeValue = (
  key: string,
  value: AttributeValue,
  expectedType: AttributeType | undefined,
  errorFactory: (token: Token, message: string) => ParseError,
): AttributeValue => {
  if (expectedType === undefined) {
    return value
  }

  if (expectedType === "string") {
    return attributeToString(value)
  }

  if (expectedType === "integer") {
    if (typeof value === "number") {
      if (!Number.isInteger(value)) {
        throw errorFactory(fakeTokenForValue(key), `Attribute "${key}" must be an integer`)
      }
      return value
    }

    const asString = attributeToString(value).trim()
    if (!/^-?\d+$/.test(asString)) {
      throw errorFactory(fakeTokenForValue(key), `Attribute "${key}" must be an integer`)
    }
    return Number.parseInt(asString, 10)
  }

  if (expectedType === "float") {
    if (typeof value === "number") {
      return value
    }
    const asString = attributeToString(value).trim()
    if (!FLOAT_PATTERN.test(asString)) {
      throw errorFactory(fakeTokenForValue(key), `Attribute "${key}" must be a number`)
    }
    return Number.parseFloat(asString)
  }

  if (expectedType === "boolean") {
    if (typeof value === "boolean") {
      return value
    }
    const asString = attributeToString(value).trim()
    if (asString === "true") {
      return true
    }
    if (asString === "false") {
      return false
    }
    throw errorFactory(fakeTokenForValue(key), `Attribute "${key}" must be true or false`)
  }

  if (isDurationValue(value)) {
    return value
  }

  const asString = attributeToString(value).trim()
  if (!DURATION_PATTERN.test(asString)) {
    throw errorFactory(fakeTokenForValue(key), `Attribute "${key}" must be a duration like 900s`)
  }
  return parseDuration(asString, errorFactory, fakeTokenForValue(key))
}

const fakeTokenForValue = (value: string): Token => ({
  kind: "identifier",
  value,
  line: 1,
  column: 1,
})

const attributeToString = (value: AttributeValue): string => {
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "number") {
    return String(value)
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }
  return value.raw
}

const parseDuration = (
  raw: string,
  errorFactory: (token: Token, message: string) => ParseError,
  token: Token,
): DurationValue => {
  const match = raw.match(DURATION_PATTERN)
  if (match === null) {
    throw errorFactory(token, `Invalid duration "${raw}"`)
  }
  const amount = Number.parseInt(match[1], 10)
  const unit = match[2] as DurationUnit
  return {
    raw,
    amount,
    unit,
    milliseconds: durationToMilliseconds(amount, unit),
  }
}

const durationToMilliseconds = (amount: number, unit: DurationUnit): number => {
  if (unit === "ms") {
    return amount
  }
  if (unit === "s") {
    return amount * 1_000
  }
  if (unit === "m") {
    return amount * 60_000
  }
  if (unit === "h") {
    return amount * 3_600_000
  }
  return amount * 86_400_000
}

const isDurationValue = (value: AttributeValue): value is DurationValue =>
  typeof value === "object" &&
  value !== null &&
  "raw" in value &&
  "unit" in value &&
  "milliseconds" in value &&
  "amount" in value

const mergeClasses = (currentValue: string, classesToAdd: string[]): string => {
  const merged = new Set<string>()
  const current = currentValue
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  for (const value of current) {
    merged.add(value)
  }
  for (const className of classesToAdd) {
    const normalized = className.trim()
    if (normalized.length > 0) {
      merged.add(normalized)
    }
  }
  return Array.from(merged).join(",")
}

const deriveSubgraphClass = (label: string): string => {
  const lowered = label.toLowerCase()
  const withHyphenatedSpaces = lowered.replace(/\s+/g, "-")
  const stripped = withHyphenatedSpaces.replace(/[^a-z0-9-]/g, "")
  return stripped.replace(/-+/g, "-").replace(/^-/, "").replace(/-$/, "")
}

const isIdentifierStart = (char: string): boolean => char.length === 1 && /[A-Za-z_]/.test(char)

const isIdentifierPart = (char: string): boolean => char.length === 1 && /[A-Za-z0-9_]/.test(char)

const isDigit = (char: string): boolean => char.length === 1 && /[0-9]/.test(char)

export const isValidIdentifier = (value: string): boolean => IDENTIFIER_PATTERN.test(value)
