# LangLens — Roadmap

## v2
- [x] Edit mode — hover + click to edit translations in context
- [x] Scanner mode — side panel listing all page strings
- [x] Hardcoded string detection
- [x] Missing translation highlighting
- [x] Reverse-lookup (no app changes needed)
- [x] Confetti on save
- [x] Persist mode across page reloads
- [x] Source editing via double-click in scanner
- [x] Locate button — scroll to element on page
- [x] Save button per scanner row
- [x] Interactive elements excluded (buttons, links, selects work normally)

## v3
- [x] Settings page in extension popup
  - [x] Backend URL (default: `localhost:5567`)
  - [x] Source language (default: `en`)
  - [x] Target language (default: `he`)
  - [x] App URL (only activate on matching pages)
- [x] Server: configurable locales path via CLI arg or env var
- [x] Server: auto-discovers all language files per namespace
- [x] Dynamic language labels (not hardcoded EN/HE)
- [x] RTL auto-detection for target language input
- [x] Generic — works with any i18next project

## v4
- [x] Interpolated variable matching (`"Hello, {{name}}"` matches `"Hello, John"`)
- [x] Detect strings inside `placeholder`, `aria-label`, `title`, `alt` attributes
- [x] Translation coverage percentage per page (badge in scanner stats)
- [x] Fuzzy matching uses both source and target language patterns
- [x] Chrome best practices: `storage.sync` for config, `storage.session` for mode state
- [x] `onChanged` listener — settings update from popup without page reload
- [x] Chrome Translator API integration — on-device AI translation suggestions (Chrome 138+)
- [x] AI "Suggest" button in scanner rows and edit overlay for missing translations
- [x] Group/category filter — multi-select dropdown by key prefix (navigation, gifts, etc.)

## v5
- [x] Export strings as JSON (all, missing, or hardcoded — based on active filter)
- [x] Import translations from JSON file (updates target language, saves to all affected namespaces)
- [x] Language switcher in scanner header — switch target language on the fly
- [x] Auto-discovers available languages from backend

## v6 (Current)
- [x] Standalone npm package (`npx langlens ./locales`)
- [x] Typed TypeScript server with Node.js http (works with Node, Bun, Deno)
- [x] CLI with help text, --port, --version flags
- [x] `langlens coverage` subcommand — check translation coverage from CI
  - [x] Per-namespace progress bars with visual report
  - [x] `--threshold` flag — exit code 1 if below threshold (CI gate)
  - [x] `--verbose` flag — list missing keys per namespace
  - [x] `--source` / `--target` language flags
- [x] Project restructured: `src/` for TypeScript, `extension/` for Chrome, `dist/` for compiled output

## v7
- [x] Auto-detect i18n framework (i18next, react-intl, next-intl, vue-i18n, ngx-translate)
  - [x] Framework detection from project's package.json
  - [x] Smarter locales directory suggestions in onboarding
  - [x] Dynamic interpolation matching in extension (`{{var}}` vs `{var}`)
  - [x] Framework info displayed in CLI and exposed via `/api/config`
- [x] Interactive onboarding wizard (`npx langlens` with no args)
  - [x] Auto-detect locales directories
  - [x] Config saved to `.langlensrc.json`
- [x] Path traversal protection on namespace/language parameters
- [x] CORS restricted to chrome-extension:// and localhost origins

## Ideas (Unscheduled)
- [ ] Publish to npm registry (`npx langlens ./locales` — zero config for users)
- [ ] Firefox extension
- [ ] Chrome Web Store publishing
- [ ] VS Code / Zed extension (show translation status inline)
- [ ] Translation memory — reuse translations for similar strings
- [ ] Glossary — enforce consistent terminology across translations
- [ ] RTL preview toggle — switch page direction without changing language
- [ ] Screenshot capture — save context screenshots with translation keys
- [ ] Webhook on save — trigger CI, notify Slack, etc.
- [ ] Show which React component renders each string (via data attributes)
- [ ] Plural form detection and editing
