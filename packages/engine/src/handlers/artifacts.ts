import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { Outcome } from "../context/outcome"

export const writeStageTextArtifact = async (
  logsRoot: string | undefined,
  nodeId: string,
  filename: string,
  contents: string,
): Promise<void> => {
  if (logsRoot === undefined || logsRoot.length === 0) {
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
