import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { AttemptLearning, ProgressState } from "./model"

export const PROGRESS_DIR_NAME = "progress"
export const PROGRESS_STATE_FILE = "state.json"

export const createProgressState = (
  specItemsPending: readonly string[],
  previous?: ProgressState,
): ProgressState => ({
  totalAttempts: previous?.totalAttempts ?? 0,
  specItemsCompleted: previous?.specItemsCompleted ?? [],
  specItemsPending,
  lastAttemptAt: previous?.lastAttemptAt ?? null,
  overallSatisfaction: previous?.overallSatisfaction ?? 0,
})

export const loadProgressState = async (
  projectRoot: string,
  specText: string,
): Promise<ProgressState> => {
  const progressDir = join(projectRoot, PROGRESS_DIR_NAME)
  await mkdir(progressDir, { recursive: true })

  const statePath = join(progressDir, PROGRESS_STATE_FILE)
  const specItems = extractSpecItems(specText)

  try {
    const raw = await readFile(statePath, "utf8")
    const parsed = parseJsonRecord(raw)

    const state: ProgressState = {
      totalAttempts: readInteger(parsed.totalAttempts, 0),
      specItemsCompleted: readStringArray(parsed.specItemsCompleted),
      specItemsPending: readStringArray(parsed.specItemsPending),
      lastAttemptAt: readNullableString(parsed.lastAttemptAt),
      overallSatisfaction: clamp01(readNumber(parsed.overallSatisfaction, 0)),
    }

    return {
      ...state,
      specItemsPending: state.specItemsPending.length > 0 ? state.specItemsPending : specItems,
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return createProgressState(specItems)
    }
    throw error
  }
}

export const saveProgressState = async (
  projectRoot: string,
  state: ProgressState,
): Promise<string> => {
  const progressDir = join(projectRoot, PROGRESS_DIR_NAME)
  await mkdir(progressDir, { recursive: true })

  const statePath = join(progressDir, PROGRESS_STATE_FILE)
  const normalized: ProgressState = {
    totalAttempts: Math.max(0, Math.floor(state.totalAttempts)),
    specItemsCompleted: Array.from(new Set(state.specItemsCompleted)),
    specItemsPending: Array.from(new Set(state.specItemsPending)),
    lastAttemptAt: state.lastAttemptAt,
    overallSatisfaction: clamp01(state.overallSatisfaction),
  }

  await writeFile(statePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  return statePath
}

export const persistAttemptLearning = async (
  projectRoot: string,
  learning: AttemptLearning,
): Promise<string> => {
  const progressDir = join(projectRoot, PROGRESS_DIR_NAME)
  await mkdir(progressDir, { recursive: true })

  const fileName = `attempt-${String(learning.attemptNumber).padStart(3, "0")}.md`
  const filePath = join(progressDir, fileName)
  const now = new Date().toISOString()

  const markdown = [
    `# Attempt ${learning.attemptNumber} — ${now}`,
    "",
    "## What was attempted",
    learning.attempted,
    "",
    "## What worked",
    ...formatBulletList(learning.worked),
    "",
    "## What failed",
    ...formatBulletList(learning.failed),
    "",
    "## Files changed",
    ...formatBulletList(learning.filesChanged),
    "",
    "## Verification summary",
    learning.verificationSummary,
    "",
    "## Backend summary",
    learning.backendSummary,
    "",
    "## Key learning",
    learning.keyLearning,
    "",
  ].join("\n")

  await writeFile(filePath, markdown, "utf8")
  return filePath
}

export const readRecentLearnings = async (
  projectRoot: string,
  limit = 3,
): Promise<string[]> => {
  const progressDir = join(projectRoot, PROGRESS_DIR_NAME)

  let files: string[]
  try {
    files = await readdir(progressDir)
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }
    throw error
  }

  const attemptFiles = files
    .filter((file) => /^attempt-\d{3}\.md$/.test(file))
    .sort((left, right) => right.localeCompare(left))
    .slice(0, Math.max(0, limit))

  const learnings: string[] = []
  for (const fileName of attemptFiles) {
    const content = await readFile(join(progressDir, fileName), "utf8")
    learnings.push(content)
  }

  return learnings
}

export const extractSpecItems = (specText: string): string[] => {
  const lines = specText.replaceAll("\r\n", "\n").split("\n")
  const items = lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("## "))
    .map((line) => line.replace(/^##\s+/, "").trim())
    .filter((line) => line.length > 0)

  return Array.from(new Set(items))
}

const formatBulletList = (values: readonly string[]): string[] => {
  if (values.length === 0) {
    return ["- None"]
  }

  return values.map((value) => `- ${value}`)
}

const parseJsonRecord = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) {
      return {}
    }
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

const readStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0)
}

const readNullableString = (value: unknown): string | null => {
  if (value === null) {
    return null
  }
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const readInteger = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback
  }
  return Math.max(0, Math.floor(value))
}

const readNumber = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback
  }
  return value
}

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0
  }
  if (value < 0) {
    return 0
  }
  if (value > 1) {
    return 1
  }
  return value
}

const isMissingFileError = (value: unknown): value is NodeJS.ErrnoException =>
  typeof value === "object" && value !== null && "code" in value && value.code === "ENOENT"
