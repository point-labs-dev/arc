export const version = "0.1.0"

export interface CliResult {
  readonly command: string
  readonly ok: boolean
  readonly message: string
}

export const runCli = async (args: readonly string[]): Promise<CliResult> => {
  const command = args[0] ?? "help"

  if (command === "help") {
    return {
      command,
      ok: true,
      message: "Arc CLI scaffold is installed",
    }
  }

  return {
    command,
    ok: false,
    message: `Unknown command: ${command}`,
  }
}
