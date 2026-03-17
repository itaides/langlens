/**
 * LangLens — i18n framework auto-detection
 *
 * Reads the project's package.json to identify the i18n library in use.
 * Provides interpolation patterns and conventional locales directory paths.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// ─── Types ──────────────────────────────────────────────────

export interface FrameworkInfo {
  name: string
  interpolation: {
    prefix: string
    suffix: string
  }
  suggestedPaths: string[]
}

// ─── Framework Definitions ──────────────────────────────────

const FRAMEWORKS: Record<
  string,
  Omit<FrameworkInfo, 'name'> & { packages: string[] }
> = {
  i18next: {
    packages: ['i18next', 'react-i18next', 'next-i18next'],
    interpolation: { prefix: '{{', suffix: '}}' },
    suggestedPaths: [
      'public/locales',
      'locales',
      'src/locales',
      'assets/locales',
    ],
  },
  'next-intl': {
    packages: ['next-intl'],
    interpolation: { prefix: '{', suffix: '}' },
    suggestedPaths: ['messages', 'locales', 'src/locales'],
  },
  'react-intl': {
    packages: ['react-intl', '@formatjs/intl'],
    interpolation: { prefix: '{', suffix: '}' },
    suggestedPaths: ['src/lang', 'src/locales', 'locales', 'lang'],
  },
  'vue-i18n': {
    packages: ['vue-i18n'],
    interpolation: { prefix: '{', suffix: '}' },
    suggestedPaths: ['src/locales', 'locales', 'src/i18n'],
  },
  'ngx-translate': {
    packages: ['@ngx-translate/core'],
    interpolation: { prefix: '{{', suffix: '}}' },
    suggestedPaths: ['src/assets/i18n', 'src/assets/locales'],
  },
}

const DEFAULT_FRAMEWORK: FrameworkInfo = {
  name: 'unknown',
  interpolation: { prefix: '{{', suffix: '}}' },
  suggestedPaths: [],
}

// ─── Detection ──────────────────────────────────────────────

export async function detectFramework(
  projectDir: string = process.cwd(),
): Promise<FrameworkInfo> {
  let pkg: Record<string, Record<string, string>>
  try {
    const raw = await readFile(join(projectDir, 'package.json'), 'utf-8')
    pkg = JSON.parse(raw)
  } catch {
    return DEFAULT_FRAMEWORK
  }

  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  }

  for (const [name, config] of Object.entries(FRAMEWORKS)) {
    if (config.packages.some((p) => p in allDeps)) {
      return {
        name,
        interpolation: config.interpolation,
        suggestedPaths: config.suggestedPaths,
      }
    }
  }

  return DEFAULT_FRAMEWORK
}
