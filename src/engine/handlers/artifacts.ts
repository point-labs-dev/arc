import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { Outcome } from "../context/outcome"

export interface StageArtifactPaths {
  readonly stageDir: string
  readonly paths: Record<string, string>
}

export const writeStageTextArtifact = async (
  logsRoot: string | undefined,
  nodeId: string,
  filename: string,
  contents: string,
): Promise<void> => {
  if (!hasLogsRoot(logsRoot)) {
    return
  }

  const stageDir = join(logsRoot, nodeId)
  await mkdir(stageDir, { recursive: true })
  await writeFile(join(stageDir, filename), contents, "utf8")
}

export const writeStageStatusArtifact = async (
  logsRoot: string | undefined,
  nodeId: string,
  result: Outcome,
): Promise<void> => {
  await writeStageTextArtifact(logsRoot, nodeId, "status.json", JSON.stringify(result, null, 2))
}

export const readStageTextArtifact = async (
  logsRoot: string | undefined,
  nodeId: string,
  filename: string,
): Promise<string | undefined> => {
  const artifactPath = resolveStageArtifactPath(logsRoot, nodeId, filename)
  if (artifactPath === undefined) {
    return undefined
  }

  try {
    return await readFile(artifactPath, "utf8")
  } catch (error) {
    if (isMissingArtifactError(error)) {
      return undefined
    }
    throw error
  }
}

export const listStageArtifactPaths = async (
  logsRoot: string | undefined,
  nodeId: string,
): Promise<StageArtifactPaths | undefined> => {
  if (!hasLogsRoot(logsRoot)) {
    return undefined
  }

  const stageDir = join(logsRoot, nodeId)
  try {
    const entries = await readdir(stageDir, { withFileTypes: true })
    const paths: Record<string, string> = {}
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue
      }
      paths[entry.name] = join(stageDir, entry.name)
    }

    return {
      stageDir,
      paths,
    }
  } catch (error) {
    if (isMissingArtifactError(error)) {
      return undefined
    }
    throw error
  }
}

const resolveStageArtifactPath = (
  logsRoot: string | undefined,
  nodeId: string,
  filename: string,
): string | undefined => {
  if (!hasLogsRoot(logsRoot)) {
    return undefined
  }
  return join(logsRoot, nodeId, filename)
}

const hasLogsRoot = (logsRoot: string | undefined): logsRoot is string =>
  logsRoot !== undefined && logsRoot.length > 0

const isMissingArtifactError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR")
