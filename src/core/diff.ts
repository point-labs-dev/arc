/**
 * Diff Utilities
 * 
 * Track file changes between iterations for:
 * - Circuit breaker (detecting no progress)
 * - Review mode (showing what changed)
 */

import { Effect } from "effect"
import { execSync } from "child_process"

// === Types ===

export interface FileChange {
  path: string
  type: "added" | "modified" | "deleted" | "renamed"
  additions: number
  deletions: number
}

export interface DiffSnapshot {
  hash: string
  timestamp: number
  changes: FileChange[]
}

// === Git Operations ===

/**
 * Get current git HEAD hash (or create initial commit if none)
 */
export const getHeadHash = (cwd: string): Effect.Effect<string, Error> =>
  Effect.try({
    try: () => {
      try {
        return execSync("git rev-parse HEAD", { cwd, encoding: "utf-8" }).trim()
      } catch {
        // No commits yet - return empty string
        return ""
      }
    },
    catch: (e) => new Error(`Failed to get HEAD: ${e}`),
  })

/**
 * Check if we're in a git repo
 */
export const isGitRepo = (cwd: string): Effect.Effect<boolean, never> =>
  Effect.sync(() => {
    try {
      execSync("git rev-parse --git-dir", { cwd, encoding: "utf-8" })
      return true
    } catch {
      return false
    }
  })

/**
 * Initialize git repo if not already one
 */
export const ensureGitRepo = (cwd: string): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const isRepo = yield* isGitRepo(cwd)
    if (!isRepo) {
      yield* Effect.try({
        try: () => {
          execSync("git init", { cwd, encoding: "utf-8" })
          execSync('git config user.email "arc@pointlabs.dev"', { cwd })
          execSync('git config user.name "Arc"', { cwd })
        },
        catch: (e) => new Error(`Failed to init git: ${e}`),
      })
    }
  })

/**
 * Stage all changes and create a snapshot commit
 */
export const createSnapshot = (
  cwd: string,
  message: string
): Effect.Effect<DiffSnapshot, Error> =>
  Effect.gen(function* () {
    yield* ensureGitRepo(cwd)
    
    const beforeHash = yield* getHeadHash(cwd)

    // Stage all changes
    yield* Effect.try({
      try: () => execSync("git add -A", { cwd, encoding: "utf-8" }),
      catch: (e) => new Error(`Failed to stage: ${e}`),
    })

    // Check if there are changes to commit
    const status = yield* Effect.try({
      try: () => execSync("git status --porcelain", { cwd, encoding: "utf-8" }),
      catch: (e) => new Error(`Failed to get status: ${e}`),
    })

    if (!status.trim()) {
      // No changes - return current state
      return {
        hash: beforeHash,
        timestamp: Date.now(),
        changes: [],
      }
    }

    // Commit
    yield* Effect.try({
      try: () => execSync(`git commit -m "${message}"`, { cwd, encoding: "utf-8" }),
      catch: (e) => new Error(`Failed to commit: ${e}`),
    })

    const afterHash = yield* getHeadHash(cwd)
    const changes = yield* getChangesBetween(cwd, beforeHash, afterHash)

    return {
      hash: afterHash,
      timestamp: Date.now(),
      changes,
    }
  })

/**
 * Get changes between two commits
 */
export const getChangesBetween = (
  cwd: string,
  fromHash: string,
  toHash: string
): Effect.Effect<FileChange[], Error> =>
  Effect.try({
    try: () => {
      if (!fromHash || !toHash || fromHash === toHash) {
        return []
      }

      const output = execSync(
        `git diff --numstat ${fromHash} ${toHash}`,
        { cwd, encoding: "utf-8" }
      )

      const changes: FileChange[] = []
      for (const line of output.split("\n").filter(Boolean)) {
        const [additions, deletions, path] = line.split("\t")
        if (path) {
          changes.push({
            path,
            type: "modified", // Simplified - could parse more precisely
            additions: parseInt(additions) || 0,
            deletions: parseInt(deletions) || 0,
          })
        }
      }

      return changes
    },
    catch: (e) => new Error(`Failed to get diff: ${e}`),
  })

/**
 * Get readable diff output for review
 */
export const getDiffText = (
  cwd: string,
  fromHash: string,
  toHash?: string
): Effect.Effect<string, Error> =>
  Effect.try({
    try: () => {
      if (!fromHash) {
        return execSync("git diff HEAD", { cwd, encoding: "utf-8" })
      }
      if (!toHash) {
        return execSync(`git diff ${fromHash}`, { cwd, encoding: "utf-8" })
      }
      return execSync(`git diff ${fromHash} ${toHash}`, { cwd, encoding: "utf-8" })
    },
    catch: (e) => new Error(`Failed to get diff text: ${e}`),
  })

/**
 * Check if there are uncommitted changes
 */
export const hasUncommittedChanges = (cwd: string): Effect.Effect<boolean, Error> =>
  Effect.try({
    try: () => {
      const status = execSync("git status --porcelain", { cwd, encoding: "utf-8" })
      return status.trim().length > 0
    },
    catch: (e) => new Error(`Failed to check status: ${e}`),
  })

/**
 * Get summary of changes for display
 */
export const formatChangeSummary = (changes: FileChange[]): string => {
  if (changes.length === 0) return "No changes"

  const totalAdded = changes.reduce((sum, c) => sum + c.additions, 0)
  const totalDeleted = changes.reduce((sum, c) => sum + c.deletions, 0)
  const fileCount = changes.length

  return `${fileCount} file${fileCount === 1 ? "" : "s"} | +${totalAdded} -${totalDeleted}`
}
