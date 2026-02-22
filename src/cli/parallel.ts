import { execFile } from "node:child_process"
import { mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

import { loadArcConfig } from "./config"
import { type GitClient, ShellGitClient } from "./git"
import type { ArcProjectConfig, VerificationResult } from "./model"
import { extractSpecItems, loadProgressState } from "./progress"
import { runConvergence } from "./convergence"
import { runVerification } from "./verification"

const execFileAsync = promisify(execFile)
const WORKTREE_DIR = ".arc-worktrees"

export interface WorktreeHandle {
  readonly item: string
  readonly branch: string
  readonly path: string
}

export interface MergeResult {
  readonly merged: boolean
  readonly conflict: boolean
  readonly error?: string
}

export interface WorktreeManager {
  createWorktree(projectRoot: string, item: string, index: number): Promise<WorktreeHandle>
  mergeBranch(projectRoot: string, branch: string): Promise<MergeResult>
  removeWorktree(projectRoot: string, handle: WorktreeHandle): Promise<void>
}

export interface RunParallelConvergenceOptions {
  readonly projectRoot: string
  readonly specPath?: string
  readonly configPath?: string
  readonly worktreeManager?: WorktreeManager
  readonly convergenceRunner?: typeof runConvergence
  readonly verificationRunner?: typeof runVerification
  readonly gitClient?: GitClient
}

export interface ParallelConvergenceResult {
  readonly success: boolean
  readonly mergedBranches: readonly string[]
  readonly failedItems: readonly string[]
  readonly message: string
}

export const runParallelConvergence = async (
  options: RunParallelConvergenceOptions,
): Promise<ParallelConvergenceResult> => {
  const specPath = options.specPath ?? join(options.projectRoot, "SPEC.md")
  const specText = await readFile(specPath, "utf8")

  const config = await loadArcConfig({
    projectRoot: options.projectRoot,
    configPath: options.configPath,
  })

  const gitClient = options.gitClient ?? new ShellGitClient()
  const isGitRepo = await gitClient.isRepository(options.projectRoot)
  if (!isGitRepo) {
    return {
      success: false,
      mergedBranches: [],
      failedItems: [],
      message: "Parallel mode requires a git repository",
    }
  }

  if (!config.parallel.useWorktrees) {
    const sequential = await (options.convergenceRunner ?? runConvergence)({
      projectRoot: options.projectRoot,
      specPath,
      configPath: options.configPath,
    })

    return {
      success: sequential.success,
      mergedBranches: [],
      failedItems: [],
      message: `Worktrees disabled; ran sequential mode: ${sequential.message}`,
    }
  }

  const progress = await loadProgressState(options.projectRoot, specText)
  const pending =
    progress.specItemsPending.length > 0 ? [...progress.specItemsPending] : extractSpecItems(specText)
  if (pending.length === 0) {
    return {
      success: true,
      mergedBranches: [],
      failedItems: [],
      message: "No pending spec items to run in parallel",
    }
  }

  const selectedItems = pending.slice(0, Math.max(1, config.parallel.maxSessions))
  const manager = options.worktreeManager ?? new ShellWorktreeManager()
  const convergenceRunner = options.convergenceRunner ?? runConvergence

  const branchRuns = await Promise.all(
    selectedItems.map(async (item, index) => {
      const handle = await manager.createWorktree(options.projectRoot, item, index)
      const result = await convergenceRunner({
        projectRoot: handle.path,
        specPath: join(handle.path, "SPEC.md"),
        configPath: join(handle.path, "arc.config.yaml"),
      })

      return {
        handle,
        result,
      }
    }),
  )

  const mergedBranches: string[] = []
  const failedItems: string[] = []

  for (const run of branchRuns) {
    if (!run.result.success) {
      failedItems.push(run.handle.item)
      continue
    }

    const merged = await manager.mergeBranch(options.projectRoot, run.handle.branch)
    if (!merged.merged) {
      failedItems.push(run.handle.item)
      continue
    }

    mergedBranches.push(run.handle.branch)
  }

  await Promise.all(
    branchRuns.map(async (run) => {
      await manager.removeWorktree(options.projectRoot, run.handle)
    }),
  )

  if (failedItems.length > 0) {
    return {
      success: false,
      mergedBranches,
      failedItems,
      message: `Parallel convergence incomplete. Failed items: ${failedItems.join(", ")}`,
    }
  }

  const verification = await verifyMergedState(options.projectRoot, specText, config, options)
  if (!verification.passed) {
    return {
      success: false,
      mergedBranches,
      failedItems: selectedItems,
      message: "Merged result failed final verification",
    }
  }

  return {
    success: true,
    mergedBranches,
    failedItems: [],
    message: `Parallel convergence merged ${mergedBranches.length} branches`,
  }
}

const verifyMergedState = async (
  projectRoot: string,
  specText: string,
  config: ArcProjectConfig,
  options: RunParallelConvergenceOptions,
): Promise<VerificationResult> =>
  (options.verificationRunner ?? runVerification)({
    projectRoot,
    specText,
    implementationSummary: "Merged parallel worktree branches",
    commands: config.verification.commands,
    commandTimeoutSeconds: config.verification.timeout,
    holdoutCommand: config.verification.holdout_command,
    holdoutTimeoutSeconds: config.verification.holdout_timeout,
    satisfactionThreshold: config.convergence.satisfactionThreshold,
    attemptNumber: 0,
  })

export class ShellWorktreeManager implements WorktreeManager {
  async createWorktree(projectRoot: string, item: string, index: number): Promise<WorktreeHandle> {
    const slug = slugify(item)
    const suffix = `${Date.now()}-${index}`
    const branch = `arc/${slug}-${suffix}`
    const root = join(projectRoot, WORKTREE_DIR)
    const path = join(root, `${slug}-${index}`)

    await mkdir(root, { recursive: true })

    await runGit(projectRoot, ["worktree", "add", "-B", branch, path, "HEAD"])

    return {
      item,
      branch,
      path,
    }
  }

  async mergeBranch(projectRoot: string, branch: string): Promise<MergeResult> {
    const result = await runGit(projectRoot, ["merge", "--no-ff", "--no-edit", branch], {
      allowFailure: true,
    })

    if (result.exitCode === 0) {
      return {
        merged: true,
        conflict: false,
      }
    }

    if (result.stderr.includes("CONFLICT") || result.stdout.includes("CONFLICT")) {
      await runGit(projectRoot, ["merge", "--abort"], { allowFailure: true })
      return {
        merged: false,
        conflict: true,
        error: result.stderr || result.stdout,
      }
    }

    return {
      merged: false,
      conflict: false,
      error: result.stderr || result.stdout,
    }
  }

  async removeWorktree(projectRoot: string, handle: WorktreeHandle): Promise<void> {
    await runGit(projectRoot, ["worktree", "remove", "--force", handle.path], { allowFailure: true })
    await runGit(projectRoot, ["branch", "-D", handle.branch], { allowFailure: true })
  }
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 48)

const runGit = async (
  cwd: string,
  args: readonly string[],
  options: {
    allowFailure?: boolean
  } = {},
): Promise<{
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}> => {
  try {
    const result = await execFileAsync("git", [...args], {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    })

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    }
  } catch (error) {
    if (!isExecError(error)) {
      throw error
    }

    const failure = {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
      exitCode: typeof error.code === "number" ? error.code : 1,
    }

    if (options.allowFailure) {
      return failure
    }

    throw new Error(failure.stderr || failure.stdout || `git ${args.join(" ")} failed`)
  }
}

const isExecError = (
  value: unknown,
): value is Error & { code?: number | string; stdout?: string; stderr?: string } =>
  typeof value === "object" && value !== null && "message" in value
