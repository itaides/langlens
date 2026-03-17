/**
 * LangLens — Interactive onboarding wizard
 *
 * Runs when `npx langlens` is called with no arguments and no existing config.
 * Guides the user through setup and saves a .langlensrc.json.
 */

import { createInterface } from 'node:readline/promises'
import { readdir, stat, readFile, writeFile } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { DEFAULT_PORT } from './server.js'

// ─── Types ──────────────────────────────────────────────────

export interface LanglensConfig {
  localesDir: string
  port: number
  sourceLang: string
  targetLang: string
}

const CONFIG_FILE = '.langlensrc.json'

// ─── Config File ────────────────────────────────────────────

export async function loadConfig(): Promise<LanglensConfig | null> {
  try {
    const raw = await readFile(CONFIG_FILE, 'utf-8')
    return JSON.parse(raw) as LanglensConfig
  } catch {
    return null
  }
}

async function saveConfig(config: LanglensConfig): Promise<void> {
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

// ─── Auto-detect locales directories ────────────────────────

const COMMON_PATHS = [
  'locales',
  'src/locales',
  'public/locales',
  'assets/locales',
  'i18n',
  'src/i18n',
  'lang',
  'src/lang',
  'packages/shared-locales',
]

interface DetectedDir {
  path: string
  namespaces: number
  languages: string[]
}

async function detectLocalesDirs(): Promise<DetectedDir[]> {
  const found: DetectedDir[] = []

  for (const candidate of COMMON_PATHS) {
    try {
      const s = await stat(candidate)
      if (!s.isDirectory()) continue

      const entries = await readdir(candidate, { withFileTypes: true })
      const subdirs = entries.filter((e) => e.isDirectory())

      if (subdirs.length === 0) continue

      // Check if subdirs contain .json files (namespace pattern)
      const firstDir = join(candidate, subdirs[0].name)
      const files = await readdir(firstDir)
      const jsonFiles = files.filter((f) => f.endsWith('.json'))

      if (jsonFiles.length > 0) {
        const languages = jsonFiles.map((f) => f.replace('.json', ''))
        found.push({ path: candidate, namespaces: subdirs.length, languages })
      }
    } catch {
      // skip
    }
  }

  return found
}

// ─── Prompt helpers ─────────────────────────────────────────

async function ask(rl: ReturnType<typeof createInterface>, question: string, fallback: string): Promise<string> {
  const answer = (await rl.question(`  ${question} [${fallback}]: `)).trim()
  return answer || fallback
}

// ─── Wizard ─────────────────────────────────────────────────

export async function runOnboarding(): Promise<LanglensConfig> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  console.log()
  console.log('  Welcome to LangLens!')
  console.log('  Let\'s set up your translation workflow.')
  console.log()
  console.log('  Tip: Run your app in dev/watch mode for live updates.')
  console.log('  Translations are saved to disk — watch mode hot-reloads them.')
  console.log()

  // ─── Locales directory ────────────────────────────────────

  let localesDir: string

  const detected = await detectLocalesDirs()

  if (detected.length > 0) {
    console.log('  Found locale directories:')
    detected.forEach((d, i) => {
      console.log(`    ${i + 1}. ./${d.path} (${d.namespaces} namespaces, ${d.languages.length} languages: ${d.languages.join(', ')})`)
    })
    console.log()

    if (detected.length === 1) {
      const confirm = await ask(rl, `Use ./${detected[0].path}? (y/n)`, 'y')
      if (confirm.toLowerCase() === 'y') {
        localesDir = detected[0].path
      } else {
        localesDir = await ask(rl, 'Path to locales directory', './locales')
      }
    } else {
      const choice = await ask(rl, 'Which directory? (number or path)', '1')
      const idx = parseInt(choice, 10) - 1
      if (idx >= 0 && idx < detected.length) {
        localesDir = detected[idx].path
      } else {
        localesDir = choice
      }
    }
  } else {
    console.log('  No locale directories auto-detected.')
    console.log()
    localesDir = await ask(rl, 'Path to locales directory', './locales')
  }

  console.log()

  // ─── Detect available languages ───────────────────────────

  const resolvedDir = resolve(localesDir)
  let availableLangs: string[] = []

  try {
    const entries = await readdir(resolvedDir, { withFileTypes: true })
    const firstNamespace = entries.find((e) => e.isDirectory())
    if (firstNamespace) {
      const files = await readdir(join(resolvedDir, firstNamespace.name))
      availableLangs = files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))
    }
  } catch {
    // couldn't read, user will type manually
  }

  // ─── Source language ──────────────────────────────────────

  if (availableLangs.length > 0) {
    console.log(`  Available languages: ${availableLangs.join(', ')}`)
    console.log()
  }

  const sourceLang = await ask(rl, 'Source language', availableLangs.includes('en') ? 'en' : availableLangs[0] || 'en')

  // ─── Target language ──────────────────────────────────────

  const otherLangs = availableLangs.filter((l) => l !== sourceLang)
  const defaultTarget = otherLangs[0] || 'he'

  const targetLang = await ask(rl, 'Target language', defaultTarget)

  // ─── Port ─────────────────────────────────────────────────

  console.log()
  const port = parseInt(await ask(rl, 'LangLens server port', String(DEFAULT_PORT)), 10)

  rl.close()

  // ─── Save ─────────────────────────────────────────────────

  const config: LanglensConfig = {
    localesDir: relative(process.cwd(), resolvedDir) || '.',
    port,
    sourceLang,
    targetLang,
  }

  await saveConfig(config)

  console.log()
  console.log(`  Config saved to ${CONFIG_FILE}`)
  console.log(`  Next time just run: npx langlens`)
  console.log()

  return config
}
