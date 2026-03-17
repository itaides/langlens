/**
 * LangLens — Translation coverage checker
 *
 * Scans locale files and reports translation coverage.
 * Exits with code 1 if coverage is below threshold.
 *
 * Usage:
 *   langlens coverage ./locales --target he --threshold 90
 */

import { flattenJson, getNamespaces, readLocaleFile } from './locale-fs.js'

// ─── Types ──────────────────────────────────────────────────

interface CoverageResult {
  namespace: string
  totalKeys: number
  translatedKeys: number
  missingKeys: string[]
  coveragePercent: number
}

interface CoverageSummary {
  results: CoverageResult[]
  totalKeys: number
  translatedKeys: number
  coveragePercent: number
}

// ─── Coverage Check ─────────────────────────────────────────

async function checkNamespaceCoverage(
  localesDir: string,
  namespace: string,
  sourceLang: string,
  targetLang: string,
): Promise<CoverageResult> {
  const sourceData = await readLocaleFile(localesDir, namespace, sourceLang)
  const targetData = await readLocaleFile(localesDir, namespace, targetLang)

  const sourceFlat = flattenJson(sourceData)
  const targetFlat = flattenJson(targetData)

  const sourceKeys = Object.keys(sourceFlat)
  const missingKeys = sourceKeys.filter((key) => !targetFlat[key])

  const totalKeys = sourceKeys.length
  const translatedKeys = totalKeys - missingKeys.length
  const coveragePercent =
    totalKeys > 0 ? Math.round((translatedKeys / totalKeys) * 100) : 100

  return { namespace, totalKeys, translatedKeys, missingKeys, coveragePercent }
}

export async function checkCoverage(
  localesDir: string,
  sourceLang: string,
  targetLang: string,
): Promise<CoverageSummary> {
  const namespaces = await getNamespaces(localesDir)

  const results = await Promise.all(
    namespaces.map((ns) =>
      checkNamespaceCoverage(localesDir, ns, sourceLang, targetLang),
    ),
  )

  const totalKeys = results.reduce((sum, r) => sum + r.totalKeys, 0)
  const translatedKeys = results.reduce((sum, r) => sum + r.translatedKeys, 0)
  const coveragePercent =
    totalKeys > 0 ? Math.round((translatedKeys / totalKeys) * 100) : 100

  return { results, totalKeys, translatedKeys, coveragePercent }
}

// ─── Report Formatting ──────────────────────────────────────

export function formatCoverageReport(
  summary: CoverageSummary,
  verbose = false,
): string {
  const lines: string[] = []
  const missingTotal = summary.totalKeys - summary.translatedKeys

  lines.push('')
  lines.push('LangLens — Translation Coverage Report')
  lines.push('═'.repeat(42))
  lines.push('')

  for (const result of summary.results) {
    const bar = makeProgressBar(result.coveragePercent)
    const status =
      result.coveragePercent === 100
        ? '✓'
        : result.coveragePercent >= 80
          ? '◐'
          : '✗'
    lines.push(
      `  ${status} ${result.namespace.padEnd(20)} ${bar} ${result.coveragePercent}% (${result.translatedKeys}/${result.totalKeys})`,
    )

    if (verbose && result.missingKeys.length > 0) {
      for (const key of result.missingKeys.slice(0, 10)) {
        lines.push(`      ⚬ ${key}`)
      }
      if (result.missingKeys.length > 10) {
        lines.push(`      ... and ${result.missingKeys.length - 10} more`)
      }
    }
  }

  lines.push('')
  lines.push('─'.repeat(42))
  lines.push(
    `  Total: ${summary.coveragePercent}% (${summary.translatedKeys}/${summary.totalKeys} keys)`,
  )

  if (missingTotal > 0) {
    lines.push(`  Missing: ${missingTotal} keys`)
  }

  lines.push('')

  return lines.join('\n')
}

function makeProgressBar(percent: number): string {
  const width = 15
  const filled = Math.round((percent / 100) * width)
  const empty = width - filled
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`
}
