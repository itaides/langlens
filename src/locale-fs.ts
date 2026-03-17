/**
 * LangLens — Shared filesystem operations for locale files
 *
 * Extracted from server.ts and coverage.ts to avoid duplication.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

// ─── Types ──────────────────────────────────────────────────

export type TranslationData = Record<string, unknown>

// ─── Namespace Discovery ────────────────────────────────────

/** Returns sorted list of namespace directories under localesDir. */
export async function getNamespaces(localesDir: string): Promise<string[]> {
  const entries = await readdir(localesDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

// ─── File Reading ───────────────────────────────────────────

/** Reads and parses a single locale JSON file. Returns `{}` on missing/invalid files. */
export async function readLocaleFile(
  localesDir: string,
  namespace: string,
  lang: string,
): Promise<TranslationData> {
  const filePath = join(localesDir, namespace, `${lang}.json`)
  try {
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw) as TranslationData
  } catch {
    return {}
  }
}

// ─── JSON Flattening ────────────────────────────────────────

/** Recursively flattens a nested object into dot-separated key-value pairs. */
export function flattenJson(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenJson(value as Record<string, unknown>, fullKey))
    } else {
      // Preserve original type — avoids corrupting arrays, numbers, booleans, null
      result[fullKey] = value
    }
  }

  return result
}
