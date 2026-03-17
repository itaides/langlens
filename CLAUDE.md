# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

LangLens is a Chrome extension + local server that lets you see and edit i18n translations directly on a running web app. The server reads/writes locale JSON files; the extension injects into the page, builds a reverse lookup map (displayed text → translation key), and provides edit/scan UI.

## Commands

```bash
# Build (TypeScript → dist/)
bun run build        # tsc

# Run dev (build + start)
bun run dev

# Start server only (requires build first)
bun start
# or: node dist/cli.js ./path/to/locales --port 5567

# Interactive onboarding (no args → wizard)
node dist/cli.js

# Check translation coverage
node dist/cli.js coverage ./path/to/locales --target fr --threshold 90 --verbose
```

No test framework is set up yet. Biome is used for linting and formatting.

**Always use `bun` instead of `npm` for running scripts and installing packages.**

## CI

GitHub Actions workflow at `.github/workflows/ci.yml`:
- Runs on push to `main` and PRs
- Uses Bun (not npm)
- Steps: install → build → verify CLI → check extension JS syntax

## Architecture

Two independent codebases in one repo:

### Server (TypeScript, `src/`)
- **`cli.ts`** — Entry point. Parses CLI args, dispatches to `serve` or `coverage` subcommand. Triggers onboarding when no args provided.
- **`server.ts`** — Node.js `http.createServer` with endpoints:
  - `GET /api/config` — returns detected framework info (interpolation pattern, etc.)
  - `GET /api/namespaces` — lists namespace directories
  - `GET/PUT /api/translations/:namespace` — read/write all language files for a namespace
- **`locale-fs.ts`** — Shared filesystem ops: namespace discovery, JSON read/parse, `flattenJson` helper. Preserves all value types (arrays, numbers, booleans) — does not coerce to strings.
- **`coverage.ts`** — Compares source vs target language keys per namespace, outputs a formatted report. Used by `langlens coverage` CLI subcommand for CI gating.
- **`onboarding.ts`** — Interactive setup wizard. Auto-detects i18n framework and locales dirs, saves config to `.langlensrc.json`.
- **`detect-framework.ts`** — Reads project's `package.json` to identify i18n framework (i18next, react-intl, next-intl, vue-i18n, ngx-translate). Provides interpolation patterns and conventional paths.

The server has zero dependencies — only `node:http`, `node:fs`, `node:path`.

### Chrome Extension (vanilla JS, `extension/`)
- Manifest V3 extension. `content.js` is the main content script injected into pages.
- `popup.html/js` — settings UI (backend URL, app URL, source/target language).
- `defaults.js` — shared default config values.
- Uses `chrome.storage.sync` for persistent config, `chrome.storage.session` for mode state.
- Two modes: **Edit** (hover + click individual strings) and **Scan** (side panel listing all page strings).
- Fetches framework config from `/api/config` to adapt interpolation matching (`{{var}}` vs `{var}`).

### Security
- Path traversal protection on namespace and language parameters (resolved path must stay inside locales dir).
- CORS restricted to `chrome-extension://` and `http://localhost` origins.
- Request body size capped at 5 MB.

### Data Flow
The extension fetches all translations from the server, builds a reverse map, then matches DOM text nodes against it. Non-string values (arrays, numbers, booleans) are preserved but skipped in reverse map matching. Edits are PUT back to the server which writes directly to the locale JSON files on disk.

## Config Files

- **`.langlensrc.json`** — Saved by onboarding wizard. Contains localesDir, port, sourceLang, targetLang, framework info. Read by CLI on startup when no args provided.

## Locale File Structure Expected

```
locales/
├── common/          # ← namespace
│   ├── en.json      # ← language
│   └── fr.json
├── dashboard/
│   ├── en.json
│   └── fr.json
```

Each namespace is a directory; each language is a JSON file within it. JSON can be nested (flattened to dot-notation keys internally). Arrays and non-string values are preserved on read/write.

## Demo GIF

The `demo/` directory (gitignored) contains a Remotion project for generating the animated demo GIF in `assets/demo.gif`. To re-render:

```bash
cd demo && npx remotion render LangLensDemo --output ../assets/demo.gif --codec gif --every-nth-frame 2
```
