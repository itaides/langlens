/**
 * LangLens — Locale file server
 *
 * Reads and writes locale JSON files from a configurable directory.
 * Works with any nested JSON locale structure (i18next, react-intl, etc.)
 */

import { readdir, writeFile } from 'node:fs/promises'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { join, resolve } from 'node:path'
import type { FrameworkInfo } from './detect-framework.js'
import {
  getNamespaces,
  readLocaleFile,
  type TranslationData,
} from './locale-fs.js'

// ─── Types ──────────────────────────────────────────────────

interface ServerConfig {
  localesDir: string
  port: number
  framework?: FrameworkInfo
}

type NamespaceTranslations = Record<string, TranslationData>

// ─── Constants ──────────────────────────────────────────────

const DEFAULT_PORT = 5567
const MAX_BODY_SIZE = 5 * 1024 * 1024 // 5 MB

const ALLOWED_ORIGIN_PATTERN =
  /^(chrome-extension:\/\/|http:\/\/localhost(:\d+)?$)/

function getCorsHeaders(origin: string | undefined): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin':
      origin && ALLOWED_ORIGIN_PATTERN.test(origin)
        ? origin
        : 'http://localhost',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

// ─── Path Safety ───────────────────────────────────────────

function isSafePath(base: string, segment: string): boolean {
  const resolved = resolve(base, segment)
  return resolved.startsWith(`${resolve(base)}/`)
}

function isSimpleName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name)
}

// ─── File Operations ────────────────────────────────────────

async function getTranslations(
  localesDir: string,
  namespace: string,
): Promise<NamespaceTranslations> {
  const dir = join(localesDir, namespace)
  const files = await readdir(dir)
  const jsonFiles = files.filter((file) => file.endsWith('.json'))

  const entries = await Promise.all(
    jsonFiles.map(async (file) => {
      const lang = file.replace('.json', '')
      const data = await readLocaleFile(localesDir, namespace, lang)
      return [lang, data] as const
    }),
  )

  return Object.fromEntries(entries)
}

async function saveTranslation(
  localesDir: string,
  namespace: string,
  lang: string,
  data: TranslationData,
): Promise<void> {
  const filePath = join(localesDir, namespace, `${lang}.json`)
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
}

// ─── HTTP Helpers ───────────────────────────────────────────

function sendJson(
  res: ServerResponse,
  data: unknown,
  status = 200,
  origin?: string,
): void {
  res.writeHead(status, getCorsHeaders(origin))
  res.end(JSON.stringify(data))
}

function sendError(
  res: ServerResponse,
  message: string,
  status = 404,
  origin?: string,
): void {
  res.writeHead(status, getCorsHeaders(origin))
  res.end(JSON.stringify({ error: message }))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let totalSize = 0

  for await (const chunk of req) {
    totalSize += (chunk as Buffer).length
    if (totalSize > MAX_BODY_SIZE) {
      throw new Error('Request body exceeds 5 MB limit')
    }
    chunks.push(chunk as Buffer)
  }

  return Buffer.concat(chunks).toString('utf-8')
}

// ─── Route Handler ──────────────────────────────────────────

function createRequestHandler(config: ServerConfig) {
  const { localesDir } = config

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', `http://localhost:${config.port}`)
    const { method } = req
    const origin = req.headers.origin

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, getCorsHeaders(origin))
      res.end()
      return
    }

    // GET /api/config
    if (url.pathname === '/api/config' && method === 'GET') {
      sendJson(res, { framework: config.framework ?? null }, 200, origin)
      return
    }

    // GET /api/namespaces
    if (url.pathname === '/api/namespaces' && method === 'GET') {
      const namespaces = await getNamespaces(localesDir)
      sendJson(res, namespaces, 200, origin)
      return
    }

    // GET/PUT /api/translations/:namespace
    const match = url.pathname.match(/^\/api\/translations\/(.+)$/)
    if (match) {
      const namespace = decodeURIComponent(match[1])

      // Path traversal protection
      if (!isSafePath(localesDir, namespace)) {
        sendError(res, 'Invalid namespace', 400, origin)
        return
      }

      if (method === 'GET') {
        const data = await getTranslations(localesDir, namespace)
        sendJson(res, data, 200, origin)
        return
      }

      if (method === 'PUT') {
        const body = JSON.parse(await readBody(req)) as Record<
          string,
          TranslationData
        >

        // Validate language keys — must be simple names (e.g. "en", "fr-CA")
        const invalidLang = Object.keys(body).find(
          (lang) => !isSimpleName(lang),
        )
        if (invalidLang) {
          sendError(res, `Invalid language key: ${invalidLang}`, 400, origin)
          return
        }

        const savePromises = Object.entries(body).map(([lang, data]) =>
          saveTranslation(localesDir, namespace, lang, data),
        )
        await Promise.all(savePromises)
        sendJson(res, { ok: true }, 200, origin)
        return
      }
    }

    sendError(res, 'Not found', 404, origin)
  }
}

// ─── Server Bootstrap ───────────────────────────────────────

export function startServer(config: ServerConfig): void {
  const handler = createRequestHandler(config)

  const server = createServer(async (req, res) => {
    try {
      await handler(req, res)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Internal server error'
      sendError(res, message, 500)
    }
  })

  server.listen(config.port, () => {
    console.log(`LangLens server running on http://localhost:${config.port}`)
    console.log(`Locales directory: ${config.localesDir}`)
  })
}

export { DEFAULT_PORT, type ServerConfig }
