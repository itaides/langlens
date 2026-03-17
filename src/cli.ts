#!/usr/bin/env node

/**
 * LangLens CLI
 *
 * Commands:
 *   npx langlens [locales-dir] [--port 5567]        Start the server
 *   npx langlens coverage [locales-dir] [options]    Check translation coverage
 */

import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { checkCoverage, formatCoverageReport } from './coverage.js'
import { detectFramework, type FrameworkInfo } from './detect-framework.js'
import { loadConfig, runOnboarding } from './onboarding.js'
import { formatScanReport, scanSourceFiles } from './scan.js'
import { DEFAULT_PORT, startServer } from './server.js'

// ─── Constants ──────────────────────────────────────────────

const VERSION = '1.2.0'

const HELP_TEXT = `
LangLens v${VERSION} — See and edit translations on your running app

Usage:
  npx langlens [locales-dir] [options]          Start the dev server
  npx langlens coverage [locales-dir] [options] Check translation coverage
  npx langlens scan [src-dir] [options]         Scan source files for hardcoded strings

Arguments:
  locales-dir              Path to locale files (default: ./locales)

Server Options:
  --port, -p <number>      Server port (default: ${DEFAULT_PORT})

Coverage Options:
  --source, -s <lang>      Source language (default: en)
  --target, -t <lang>      Target language (default: he)
  --threshold <number>     Minimum coverage % to pass (default: 0)
  --verbose                Show missing keys per namespace

Scan Options:
  --ext <extensions>       File extensions to scan (default: tsx,ts,jsx,js)
  --threshold <number>     Max hardcoded strings allowed (default: 0, exit 1 if exceeded)
  --verbose                Show all hardcoded strings per file

General:
  --help, -h               Show this help
  --version, -v            Show version

Examples:
  npx langlens ./src/locales
  npx langlens ./src/locales --port 3456
  npx langlens coverage ./src/locales --target fr --threshold 90
  npx langlens coverage ./src/locales --target he --verbose
  npx langlens scan ./src --verbose
  npx langlens scan ./src --ext tsx --threshold 0

Environment Variables:
  LANGLENS_LOCALES_DIR     Locales directory
  LANGLENS_PORT            Server port
`.trim()

// ─── Argument Parsing ───────────────────────────────────────

interface CliArgs {
  command: 'serve' | 'coverage' | 'scan'
  localesDir: string
  port: number
  sourceLang: string
  targetLang: string
  threshold: number
  verbose: boolean
  help: boolean
  version: boolean
  framework?: FrameworkInfo
  scanExtensions?: string[]
}

function parseArgs(argv: string[]): CliArgs {
  const raw = argv.slice(2)
  let command: 'serve' | 'coverage' | 'scan' = 'serve'
  let localesDir = process.env.LANGLENS_LOCALES_DIR || './locales'
  let port = parseInt(process.env.LANGLENS_PORT || String(DEFAULT_PORT), 10)
  let sourceLang = 'en'
  let targetLang = 'he'
  let threshold = 0
  let verbose = false
  let help = false
  let version = false

  let scanExtensions: string[] | undefined

  // Check if first arg is a subcommand
  const args = [...raw]
  if (args[0] === 'coverage') {
    command = 'coverage'
    args.shift()
  } else if (args[0] === 'scan') {
    command = 'scan'
    args.shift()
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--help' || arg === '-h') {
      help = true
      continue
    }
    if (arg === '--version' || arg === '-v') {
      version = true
      continue
    }
    if (arg === '--verbose') {
      verbose = true
      continue
    }

    if (arg === '--port' || arg === '-p') {
      const next = args[++i]
      if (!next || Number.isNaN(parseInt(next, 10))) {
        console.error('Error: --port requires a number')
        process.exit(1)
      }
      port = parseInt(next, 10)
      continue
    }

    if (arg === '--source' || arg === '-s') {
      sourceLang = args[++i] || 'en'
      continue
    }

    if (arg === '--target' || arg === '-t') {
      targetLang = args[++i] || 'he'
      continue
    }

    if (arg === '--ext') {
      const next = args[++i]
      if (next) scanExtensions = next.split(',').map((e) => e.trim())
      continue
    }

    if (arg === '--threshold') {
      const next = args[++i]
      if (!next || Number.isNaN(parseInt(next, 10))) {
        console.error('Error: --threshold requires a number')
        process.exit(1)
      }
      threshold = parseInt(next, 10)
      continue
    }

    if (!arg.startsWith('-')) {
      localesDir = arg
      continue
    }

    console.error(`Unknown option: ${arg}`)
    console.error('Run "npx langlens --help" for usage')
    process.exit(1)
  }

  return {
    command,
    localesDir: resolve(localesDir),
    port,
    sourceLang,
    targetLang,
    threshold,
    verbose,
    help,
    version,
    scanExtensions,
  }
}

// ─── Validation ─────────────────────────────────────────────

async function validateLocalesDir(dir: string): Promise<void> {
  try {
    const dirStat = await stat(dir)
    if (!dirStat.isDirectory()) {
      console.error(`Error: ${dir} is not a directory`)
      process.exit(1)
    }
  } catch {
    console.error(`Error: Directory not found: ${dir}`)
    console.error(
      'Create it or specify a different path: npx langlens ./path/to/locales',
    )
    process.exit(1)
  }
}

// ─── Commands ───────────────────────────────────────────────

async function runServe(args: CliArgs): Promise<void> {
  await validateLocalesDir(args.localesDir)

  // Detect framework if not already set (e.g. from config or onboarding)
  const framework = args.framework ?? (await detectFramework())
  if (framework.name !== 'unknown') {
    console.log(
      `Framework: ${framework.name} (interpolation: ${framework.interpolation.prefix}var${framework.interpolation.suffix})`,
    )
  }

  startServer({ localesDir: args.localesDir, port: args.port, framework })
}

async function runCoverage(args: CliArgs): Promise<void> {
  await validateLocalesDir(args.localesDir)

  const summary = await checkCoverage(
    args.localesDir,
    args.sourceLang,
    args.targetLang,
  )
  const report = formatCoverageReport(summary, args.verbose)
  console.log(report)

  if (args.threshold > 0 && summary.coveragePercent < args.threshold) {
    console.error(
      `Coverage ${summary.coveragePercent}% is below threshold ${args.threshold}%`,
    )
    process.exit(1)
  }
}

async function runScan(args: CliArgs): Promise<void> {
  const srcDir = args.localesDir // reuse the positional arg as src dir
  await validateLocalesDir(srcDir)

  const summary = await scanSourceFiles(srcDir, args.scanExtensions)
  const report = formatScanReport(summary, args.verbose)
  console.log(report)

  if (args.threshold > 0 && summary.totalHardcoded > args.threshold) {
    console.error(
      `Found ${summary.totalHardcoded} hardcoded strings (threshold: ${args.threshold})`,
    )
    process.exit(1)
  }
}

// ─── Main ───────────────────────────────────────────────────

function hasUserArgs(argv: string[]): boolean {
  return argv.slice(2).some((a) => a !== 'coverage')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)

  if (args.help) {
    console.log(HELP_TEXT)
    process.exit(0)
  }

  if (args.version) {
    console.log(`langlens v${VERSION}`)
    process.exit(0)
  }

  if (args.command === 'coverage') {
    await runCoverage(args)
    return
  }

  if (args.command === 'scan') {
    await runScan(args)
    return
  }

  // No user-provided args — check for saved config or run onboarding
  if (!hasUserArgs(process.argv)) {
    const saved = await loadConfig()
    if (saved) {
      args.localesDir = resolve(saved.localesDir)
      args.port = saved.port
      args.sourceLang = saved.sourceLang
      args.targetLang = saved.targetLang
      args.framework = saved.framework
    } else {
      const config = await runOnboarding()
      args.localesDir = resolve(config.localesDir)
      args.port = config.port
      args.sourceLang = config.sourceLang
      args.targetLang = config.targetLang
      args.framework = config.framework
    }
  }

  await runServe(args)
}

main()
