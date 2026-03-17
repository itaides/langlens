/**
 * LangLens — Source file scanner
 *
 * Scans .tsx/.ts/.jsx/.js files for hardcoded strings
 * that should be wrapped in i18n t() calls.
 *
 * Usage:
 *   langlens scan ./src --ext tsx,ts
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

// ─── Types ──────────────────────────────────────────────────

interface HardcodedString {
  file: string
  line: number
  text: string
  context: 'jsx-content' | 'prop' | 'toast' | 'confirm' | 'aria'
}

interface ScanResult {
  file: string
  hardcoded: HardcodedString[]
}

interface ScanSummary {
  results: ScanResult[]
  totalFiles: number
  filesWithIssues: number
  totalHardcoded: number
}

// ─── Constants ──────────────────────────────────────────────

const DEFAULT_EXTENSIONS = new Set(['.tsx', '.ts', '.jsx', '.js'])

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  '.git',
  'coverage',
  '__tests__',
  '__mocks__',
])

// Patterns that indicate a string is already translated or not translatable
const IGNORE_PATTERNS = [
  /^[^a-zA-Z]*$/, // No letters (numbers, symbols only)
  /^https?:\/\//, // URLs
  /^[a-z]+[-_][a-z]+$/, // kebab-case / snake_case identifiers
  /^[A-Z_]+$/, // CONSTANT_NAMES
  /^#[0-9a-fA-F]+$/, // Hex colors
  /^\d+(\.\d+)?(px|rem|em|%|vh|vw|ms|s)$/, // CSS values
  /^[a-z]+\.[a-z]+/, // Dotted keys like "admin.title"
  /^(true|false|null|undefined)$/, // Literals
  /^(GET|POST|PUT|DELETE|PATCH|OPTIONS)$/, // HTTP methods
  /^(div|span|button|input|form|label|p|h[1-6])$/, // HTML tags
  /^(sm|md|lg|xl|2xl)$/, // Tailwind breakpoints
  /^(default|outline|ghost|destructive|secondary|link)$/, // Variant names
]

// Minimum length for a string to be considered translatable
const MIN_STRING_LENGTH = 2

// ─── File Discovery ─────────────────────────────────────────

async function findSourceFiles(
  dir: string,
  extensions: Set<string>,
): Promise<string[]> {
  const files: string[] = []

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(join(currentDir, entry.name))
        }
      } else if (extensions.has(extname(entry.name))) {
        files.push(join(currentDir, entry.name))
      }
    }
  }

  await walk(dir)
  return files.sort()
}

// ─── String Detection ───────────────────────────────────────

function isLikelyTranslatable(text: string): boolean {
  if (text.length < MIN_STRING_LENGTH) return false
  if (!/[a-zA-Z\u0590-\u05FF\u0600-\u06FF]/.test(text)) return false

  for (const pattern of IGNORE_PATTERNS) {
    if (pattern.test(text)) return false
  }

  // Must contain at least one uppercase letter or space (human-readable text)
  if (!(/[A-Z]/.test(text) || /\s/.test(text))) return false

  return true
}

function scanFileContent(content: string, filePath: string): HardcodedString[] {
  const results: HardcodedString[] = []
  const lines = content.split('\n')

  // Check if file already uses useTranslation
  const _usesI18n =
    /useTranslation|import.*i18next|from ['"]react-i18next/.test(content)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // Skip comments and imports
    if (/^\s*(\/\/|\/\*|\*|import |export type )/.test(line)) continue

    // 1. JSX text content: >Some Text<
    const jsxTextMatches = line.matchAll(/>([^<>{]+)</g)
    for (const match of jsxTextMatches) {
      const text = match[1].trim()
      if (!text || /^\{/.test(text)) continue // Skip expressions
      if (/\{t\(/.test(line)) continue // Line already uses t()
      if (isLikelyTranslatable(text)) {
        results.push({
          file: filePath,
          line: lineNum,
          text,
          context: 'jsx-content',
        })
      }
    }

    // 2. String props: title="Text", placeholder="Text", label="Text", description="Text"
    const propMatches = line.matchAll(
      /(title|placeholder|label|description|alt)="([^"]+)"/g,
    )
    for (const match of propMatches) {
      const text = match[2]
      if (/\{t\(/.test(text)) continue
      if (isLikelyTranslatable(text)) {
        results.push({ file: filePath, line: lineNum, text, context: 'prop' })
      }
    }

    // 3. aria-label="Text"
    const ariaMatches = line.matchAll(/aria-label="([^"]+)"/g)
    for (const match of ariaMatches) {
      const text = match[1]
      if (isLikelyTranslatable(text)) {
        results.push({ file: filePath, line: lineNum, text, context: 'aria' })
      }
    }

    // 4. toast.success("Text"), toast.error("Text")
    const toastMatches = line.matchAll(/toast\.\w+\(['"]([^'"]+)['"]/g)
    for (const match of toastMatches) {
      const text = match[1]
      if (/t\(/.test(text)) continue
      if (isLikelyTranslatable(text)) {
        results.push({ file: filePath, line: lineNum, text, context: 'toast' })
      }
    }

    // 5. confirm("Text"), window.confirm("Text")
    const confirmMatches = line.matchAll(
      /(?:window\.)?confirm\(['"]([^'"]+)['"]/g,
    )
    for (const match of confirmMatches) {
      const text = match[1]
      if (/t\(/.test(text)) continue
      if (isLikelyTranslatable(text)) {
        results.push({
          file: filePath,
          line: lineNum,
          text,
          context: 'confirm',
        })
      }
    }
  }

  // Deduplicate by line+text
  const seen = new Set<string>()
  return results.filter((r) => {
    const key = `${r.line}:${r.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ─── Public API ─────────────────────────────────────────────

export async function scanSourceFiles(
  srcDir: string,
  extensions?: string[],
): Promise<ScanSummary> {
  const extSet = extensions
    ? new Set(extensions.map((e) => (e.startsWith('.') ? e : `.${e}`)))
    : DEFAULT_EXTENSIONS

  const dirStat = await stat(srcDir)
  if (!dirStat.isDirectory()) {
    throw new Error(`${srcDir} is not a directory`)
  }

  const files = await findSourceFiles(srcDir, extSet)
  const results: ScanResult[] = []

  for (const file of files) {
    const content = await readFile(file, 'utf-8')
    const hardcoded = scanFileContent(content, relative(process.cwd(), file))

    if (hardcoded.length > 0) {
      results.push({ file: relative(process.cwd(), file), hardcoded })
    }
  }

  // Sort by number of issues (worst files first)
  results.sort((a, b) => b.hardcoded.length - a.hardcoded.length)

  const totalHardcoded = results.reduce((sum, r) => sum + r.hardcoded.length, 0)

  return {
    results,
    totalFiles: files.length,
    filesWithIssues: results.length,
    totalHardcoded,
  }
}

// ─── Report Formatting ──────────────────────────────────────

const CONTEXT_LABELS: Record<string, string> = {
  'jsx-content': 'JSX',
  prop: 'prop',
  toast: 'toast',
  confirm: 'confirm',
  aria: 'aria',
}

export function formatScanReport(
  summary: ScanSummary,
  verbose = false,
): string {
  const lines: string[] = []

  lines.push('')
  lines.push('LangLens — Hardcoded String Scan')
  lines.push('═'.repeat(42))
  lines.push('')
  lines.push(`  Scanned: ${summary.totalFiles} files`)
  lines.push(
    `  Issues:  ${summary.filesWithIssues} files with hardcoded strings`,
  )
  lines.push(`  Total:   ${summary.totalHardcoded} hardcoded strings found`)
  lines.push('')

  if (summary.results.length === 0) {
    lines.push('  ✓ No hardcoded strings found!')
    lines.push('')
    return lines.join('\n')
  }

  lines.push('─'.repeat(42))
  lines.push('')

  for (const result of summary.results) {
    const icon = result.hardcoded.length > 5 ? '✗' : '◐'
    lines.push(`  ${icon} ${result.file} (${result.hardcoded.length})`)

    if (verbose) {
      for (const h of result.hardcoded.slice(0, 10)) {
        const ctx = CONTEXT_LABELS[h.context] || h.context
        const text = h.text.length > 50 ? `${h.text.slice(0, 47)}...` : h.text
        lines.push(`      L${h.line} [${ctx}] "${text}"`)
      }
      if (result.hardcoded.length > 10) {
        lines.push(`      ... and ${result.hardcoded.length - 10} more`)
      }
      lines.push('')
    }
  }

  if (!verbose && summary.results.length > 0) {
    lines.push('')
    lines.push('  Run with --verbose to see all hardcoded strings')
  }

  lines.push('')

  return lines.join('\n')
}
