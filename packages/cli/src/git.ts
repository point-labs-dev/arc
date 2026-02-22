import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const GIT_BUFFER_BYTES = 8 * 1024 * 1024

export interface GitCommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface GitClient {
  isRepository(cwd: string): Promise<boolean>
  getStatus(cwd: string): Promise<string>
  getDiffSummary(cwd: string): Promise<string>
  getChangedFiles(cwd: string): Promise<string[]>
  commitAll(cwd: string, message: string): Promise<string | undefined>
}

export class ShellGitClient implements GitClient {
  async isRepository(cwd: string): Promise<boolean> {
    const result = await runGit(["rev-parse", "--is-inside-work-tree"], cwd)
    return result.exitCode === 0 && result.stdout.trim() === "true"
  }

  async getStatus(cwd: string): Promise<string> {
    const result = await runGit(["status", "--short"], cwd)
    return result.stdout.trim()
  }

  async getDiffSummary(cwd: string): Promise<string> {
    const result = await runGit(["diff", "--stat"], cwd)
    return result.stdout.trim()
  }

  async getChangedFiles(cwd: string): Promise<string[]> {
    const result = await runGit(["status", "--porcelain"], cwd)
    if (result.exitCode !== 0) {
      return []
    }

    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 3)
      .map((line) => {
        const withoutStatus = line.slice(3).trim()
        const renameParts = withoutStatus.split(" -> ")
        return renameParts[renameParts.length - 1]
      })
      .filter((path) => path.length > 0)
  }

  async commitAll(cwd: string, message: string): Promise<string | undefined> {
    await runGit(["add", "-A"], cwd)
    const hasStaged = await runGit(["diff", "--cached", "--quiet"], cwd)
    if (hasStaged.exitCode === 0) {
      return undefined
    }

    const commitResult = await runGit(["commit", "-m", message], cwd)
    if (commitResult.exitCode !== 0) {
      throw new Error(commitResult.stderr || commitResult.stdout || "git commit failed")
    }

    const hashResult = await runGit(["rev-parse", "HEAD"], cwd)
    if (hashResult.exitCode !== 0) {
      return undefined
    }

    return hashResult.stdout.trim() || undefined
  }
}

export const collectProjectSnapshot = async (cwd: string): Promise<string> => {
  const status = await runGit(["status", "--short"], cwd)
  const diff = await runGit(["diff", "--stat"], cwd)

  return [
    "Git status:",
    status.stdout.trim() || "(clean)",
    "",
    "Diff summary:",
    diff.stdout.trim() || "(no diff)",
  ].join("\n")
}

const runGit = async (args: readonly string[], cwd: string): Promise<GitCommandResult> => {
  try {
    const result = await execFileAsync("git", [...args], {
      cwd,
      maxBuffer: GIT_BUFFER_BYTES,
      env: process.env,
    })

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    }
  } catch (error) {
    if (isExecError(error)) {
      return {
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? error.message,
        exitCode: typeof error.code === "number" ? error.code : 1,
      }
    }

    throw error
  }
}

const isExecError = (
  value: unknown,
): value is Error & { code?: number | string; stdout?: string; stderr?: string } =>
  typeof value === "object" && value !== null && "message" in value
