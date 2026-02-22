import type { AttributeMap, AttributeValue, DurationValue } from "./types"

export const attributeToString = (value: AttributeValue | undefined): string => {
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

export const readAttributeString = (attrs: AttributeMap, key: string, fallback = ""): string => {
  const value = attrs[key]
  if (value === undefined) {
    return fallback
  }
  return attributeToString(value)
}

export const readAttributeInteger = (attrs: AttributeMap, key: string, fallback = 0): number => {
  const value = attrs[key]
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : fallback
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10)
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0
  }
  return fallback
}

export const readAttributeBoolean = (
  attrs: AttributeMap,
  key: string,
  fallback = false,
): boolean => {
  const value = attrs[key]
  if (typeof value === "boolean") {
    return value
  }
  if (typeof value === "string") {
    if (value === "true") {
      return true
    }
    if (value === "false") {
      return false
    }
  }
  return fallback
}

export const readAttributeDurationMilliseconds = (
  attrs: AttributeMap,
  key: string,
): number | undefined => {
  const value = attrs[key]
  if (isDurationValue(value)) {
    return value.milliseconds
  }

  if (typeof value === "string") {
    const parsed = parseDuration(value)
    if (parsed !== undefined) {
      return parsed.milliseconds
    }
  }

  return undefined
}

export const attributeValueToSerializable = (value: AttributeValue): unknown => {
  if (isDurationValue(value)) {
    return {
      raw: value.raw,
      amount: value.amount,
      unit: value.unit,
      milliseconds: value.milliseconds,
    }
  }
  return value
}

const parseDuration = (raw: string): DurationValue | undefined => {
  const match = raw.trim().match(/^(-?\d+)(ms|s|m|h|d)$/)
  if (match === null) {
    return undefined
  }

  const amount = Number.parseInt(match[1], 10)
  const unit = match[2] as DurationValue["unit"]
  return {
    raw: match[0],
    amount,
    unit,
    milliseconds: durationToMilliseconds(amount, unit),
  }
}

const durationToMilliseconds = (amount: number, unit: DurationValue["unit"]): number => {
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

const isDurationValue = (value: AttributeValue | undefined): value is DurationValue =>
  typeof value === "object" &&
  value !== null &&
  "raw" in value &&
  "amount" in value &&
  "unit" in value &&
  "milliseconds" in value
