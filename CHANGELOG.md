# Changelog

All notable changes to LangLens are documented here.

## [1.2.0] - 2026-03-17

### Added
- `langlens scan` CLI command — scans source files for hardcoded strings not wrapped in `t()`
- Detects JSX content, string props, toast messages, confirm dialogs, aria labels
- `--ext` flag to filter by file extension
- `--threshold` flag for CI gating (exit 1 if exceeded)
- `--verbose` flag to list all findings per file
- `CLI.md` — dedicated CLI documentation

## [1.1.0] - 2026-03-17

### Added
- Interactive onboarding wizard (`npx langlens` with no args)
- Auto-detect i18n framework (i18next, react-intl, next-intl, vue-i18n, ngx-translate)
- Config saved to `.langlensrc.json` for subsequent runs
- Cloudflare tunnel support in Chrome extension manifest

## [1.0.0] - 2026-03-17

### Added
- Chrome extension with two modes:
  - **Edit mode** — hover + click to edit translations in context
  - **Scanner mode** — side panel listing all page strings on current page
- Hardcoded string detection in scanner (flags text not using i18n)
- Fuzzy matching for interpolated variables (`"Hello, {{name}}"` matches `"Hello, John"`)
- Attribute scanning (`placeholder`, `aria-label`, `title`, `alt`)
- Translation coverage percentage per page
- Chrome Translator API integration (on-device AI suggestions, Chrome 138+)
- Group/category filter (multi-select dropdown by key prefix)
- Export/import translations as JSON
- Language switcher in scanner header
- Source text editing via double-click in scanner
- Save button per scanner row
- Confetti on save
- Edit mode persists across page reloads (`chrome.storage.session`)
- Settings sync across devices (`chrome.storage.sync`)
- Settings update from popup without page reload (`onChanged` listener)
- Interactive elements excluded from interception (buttons, links, selects work normally)
- `npx langlens` — standalone dev server (Node.js + Bun compatible)
- `npx langlens coverage` — translation coverage checker for CI
- Configurable via CLI args, env vars, or extension popup
- RTL auto-detection for target language input
- Shared `locale-fs.ts` module for server/coverage code reuse
- Glass-morphism UI with CSS layers, nesting, and `color-mix()`
