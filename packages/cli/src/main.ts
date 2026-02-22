#!/usr/bin/env node

import { runCli } from "./index"

const result = await runCli(process.argv.slice(2))
if (result.ok) {
  process.stdout.write(`${result.message}\n`)
  process.exit(0)
}

process.stderr.write(`${result.message}\n`)
process.exit(1)
