# LangLens

A Chrome extension that lets you see and edit translations directly on your running app. No more switching between JSON files and your browser — hover over any text, see its translation key, and edit it in place.

Built for teams where content editors, PMs, and translators need to review and fix translations without touching code.

## Quick Start

```bash
# Interactive setup (auto-detects your i18n framework and locales)
npx langlens

# Or specify the path directly
npx langlens ./path/to/locales
bun run langlens ./path/to/locales
```

Then load the Chrome extension and open your app.

## Features

### Edit Mode
Hover over any text to see if it has a translation key. Click to open an edit popup — see the source language, edit the target language. Changes write directly to your locale JSON files.

### Scanner Mode
Side panel showing ALL translatable strings on the current page:
- Filter by: All, Missing, Hardcoded, Translated
- Group filter by key prefix (navigation, gifts, dashboard...)
- Search across keys and values
- Edit translations inline with Save button
- Double-click source text to edit it too
- "Locate" button scrolls to the element on the page
- Translation coverage percentage
- Export/import strings as JSON
- Language switcher — change target language on the fly

### Hardcoded Detection
Flags text on the page that isn't using your i18n system — helps developers find strings that need to be wrapped with `t()`.

### AI Translation (Chrome 138+)
On-device AI translation suggestions via Chrome's built-in Translator API. No server calls, fully private. Appears as an "AI" button on missing strings.

## How It Works

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Your App    │     │  LangLens    │     │  Server      │
│  (browser)   │◄───►│  (extension) │◄───►│  (any runtime)│
│              │     │              │     │              │
│  Reads DOM   │     │ Reverse-maps │     │ Reads/writes │
│  text nodes  │     │ text → keys  │     │ JSON files   │
└──────────────┘     └──────────────┘     └──────────────┘
```

The extension loads all your translation JSON files via the server, builds a reverse lookup map (displayed text → translation key), then matches text on the page. No changes to your app needed.

## Setup

### 1. Start the server

```bash
# Interactive setup — auto-detects framework, locales dir, languages
npx langlens

# Or specify directly
npx langlens ./src/locales
bun run langlens ./src/locales

# With options
npx langlens ./src/locales --port 3456
```

On first run without arguments, LangLens will:
- Detect your i18n framework (i18next, react-intl, next-intl, vue-i18n, ngx-translate)
- Scan for locale directories
- Ask for source/target languages and port
- Save config to `.langlensrc.json` (next run just uses it)

The server expects locale files structured as:
```
locales/
├── common/
│   ├── en.json
│   └── fr.json
├── dashboard/
│   ├── en.json
│   └── fr.json
```

### 2. Install the Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` directory

### 3. Configure

Click the LangLens icon in the Chrome toolbar to open settings:
- **Backend URL** — where the server runs (default: `localhost:5567`)
- **App URL** — your app's URL (default: `localhost:5555`)
- **Source language** — e.g., `en`
- **Target language** — e.g., `fr`, `he`, `es`

### 4. Use it

1. Open your app in Chrome
2. Click **Edit** to hover + click on individual strings
3. Click **Scan** to open the side panel with all page strings

## CLI Reference

```
npx langlens [locales-dir] [options]

Arguments:
  locales-dir          Path to locale files (default: ./locales)

Options:
  --port, -p <number>  Server port (default: 5567)
  --help, -h           Show help
  --version, -v        Show version

Environment Variables:
  LANGLENS_LOCALES_DIR  Locales directory
  LANGLENS_PORT         Server port
```

## Project Structure

```
langlens/
├── src/
│   ├── cli.ts              # CLI entry (npx langlens)
│   ├── server.ts           # HTTP server
│   ├── locale-fs.ts        # Locale file operations
│   ├── coverage.ts         # Translation coverage checker
│   ├── onboarding.ts       # Interactive setup wizard
│   └── detect-framework.ts # i18n framework auto-detection
├── extension/
│   ├── manifest.json     # Chrome extension manifest v3
│   ├── content.js        # Content script
│   ├── styles.css        # Extension styles
│   ├── popup.html        # Settings page
│   ├── popup.js          # Settings logic
│   └── icon.png          # Extension icon
├── package.json
├── tsconfig.json
├── README.md
└── ROADMAP.md
```

## Requirements

- Node.js 18+ or Bun (for the server)
- Chrome or Chromium-based browser (for the extension)
- Locale files in nested JSON format (auto-detects i18next, react-intl, next-intl, vue-i18n, ngx-translate)

## Limitations

- Reverse lookup can't match strings with interpolated variables rendered as final text (e.g., "Hello, John" won't match `"Hello, {{name}}"`) — fuzzy matching covers most cases
- Very short strings (1-2 characters) are skipped to avoid false positives
- The extension runs on localhost URLs by default — edit `manifest.json` for other hosts

## License

MIT
