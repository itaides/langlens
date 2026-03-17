# Auto-detect i18n Framework — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically detect the project's i18n framework to improve onboarding suggestions, interpolation matching, and provide user-visible framework info.

**Architecture:** New `detect-framework.ts` module reads the project's `package.json` to identify the i18n library. The detected framework drives: (1) locales directory suggestions in onboarding, (2) interpolation pattern in the server config exposed via a new `/api/config` endpoint, (3) the extension reads config and switches its fuzzy matching regex accordingly.

**Tech Stack:** Node.js fs, existing server/onboarding/extension code.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/detect-framework.ts` | Create | Framework detection logic + interpolation patterns |
| `src/onboarding.ts` | Modify | Use detected framework for smarter directory suggestions |
| `src/server.ts` | Modify | Accept framework config, add `GET /api/config` endpoint |
| `src/cli.ts` | Modify | Run detection, pass framework to server |
| `extension/content.js` | Modify | Fetch `/api/config`, use dynamic interpolation pattern |

---

### Task 1: Framework Detection Module

**Files:**
- Create: `src/detect-framework.ts`

- [ ] **Step 1: Create the detection module**

```ts
// src/detect-framework.ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface FrameworkInfo {
  name: string                  // e.g. "i18next", "react-intl", "next-intl", "vue-i18n", "ngx-translate", "unknown"
  interpolation: {
    prefix: string              // e.g. "{{" or "{"
    suffix: string              // e.g. "}}" or "}"
  }
  suggestedPaths: string[]      // conventional locales dirs for this framework
}

const FRAMEWORKS: Record<string, Omit<FrameworkInfo, 'name'> & { packages: string[] }> = {
  'i18next': {
    packages: ['i18next', 'react-i18next', 'next-i18next'],
    interpolation: { prefix: '{{', suffix: '}}' },
    suggestedPaths: ['public/locales', 'locales', 'src/locales', 'assets/locales'],
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

export async function detectFramework(projectDir: string = process.cwd()): Promise<FrameworkInfo> {
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
```

- [ ] **Step 2: Verify it compiles**

Run: `bun run build`
Expected: clean build

- [ ] **Step 3: Commit**

```bash
git add src/detect-framework.ts
git commit -m "feat: add i18n framework detection module"
```

---

### Task 2: Integrate Detection into Onboarding

**Files:**
- Modify: `src/onboarding.ts` (lines ~40-80, detection + directory suggestions)

- [ ] **Step 1: Import and use framework detection in onboarding**

In `onboarding.ts`:
- Import `detectFramework` from `./detect-framework.js`
- Call it at the start of `runOnboarding()`
- If a framework is detected, display it: `"Detected i18n framework: i18next"`
- Prepend the framework's `suggestedPaths` to `COMMON_PATHS` for auto-detection
- Add `framework` field to `LanglensConfig` interface and save it to `.langlensrc.json`

Key changes:
- `LanglensConfig` gets a new `framework` field (the `FrameworkInfo` object)
- `detectLocalesDirs()` takes an optional `extraPaths` param
- Display the detected framework before the directory scan

- [ ] **Step 2: Verify it compiles**

Run: `bun run build`
Expected: clean build

- [ ] **Step 3: Commit**

```bash
git add src/onboarding.ts
git commit -m "feat: use framework detection in onboarding wizard"
```

---

### Task 3: Expose Framework Config via Server API

**Files:**
- Modify: `src/server.ts` (add `/api/config` endpoint, extend `ServerConfig`)
- Modify: `src/cli.ts` (pass framework info to server)

- [ ] **Step 1: Extend ServerConfig and add /api/config endpoint**

In `server.ts`:
- Add `framework` field to `ServerConfig` (import `FrameworkInfo` type)
- Add route: `GET /api/config` that returns `{ framework: config.framework }`

In `cli.ts`:
- Import `detectFramework`
- In `runServe()`, call `detectFramework()` and pass result to `startServer()`
- When loading from `.langlensrc.json`, use the saved framework info
- Display: `"Framework: i18next"` when starting the server

- [ ] **Step 2: Verify it compiles**

Run: `bun run build`
Expected: clean build

- [ ] **Step 3: Test the endpoint manually**

Run: `node dist/cli.js /path/to/locales` (in a project with i18next)
Then: `curl http://localhost:5567/api/config`
Expected: `{"framework":{"name":"i18next","interpolation":{"prefix":"{{","suffix":"}}"},...}}`

- [ ] **Step 4: Commit**

```bash
git add src/server.ts src/cli.ts
git commit -m "feat: expose framework config via GET /api/config"
```

---

### Task 4: Dynamic Interpolation in Extension

**Files:**
- Modify: `extension/content.js` (lines ~101-111, fuzzy pattern building + config fetch)

- [ ] **Step 1: Fetch framework config from server**

In `content.js`:
- Add a new `frameworkConfig` variable (default: `{ interpolation: { prefix: '{{', suffix: '}}' } }`)
- In `loadTranslations()`, fetch `/api/config` from the backend and store the framework config
- No extra error handling needed — if the endpoint fails, the default `{{}}` is used

- [ ] **Step 2: Use dynamic interpolation in fuzzy matching**

Replace the hardcoded `{{` detection in `addFuzzyPattern()`:
- Currently: `if (!value.includes('{{')) return` and regex replaces `\{\{...\}\}`
- Change to: use `frameworkConfig.interpolation.prefix/suffix` to build the detection and regex
- The regex pattern should escape the prefix/suffix and match content between them

Current code (lines 104-111):
```js
function addFuzzyPattern(value, entry) {
  if (!value.includes('{{')) return
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = escaped.replace(/\\\{\\{[^}]+\\\}\\}/g, '.+')
  ...
}
```

New code:
```js
function addFuzzyPattern(value, entry) {
  const { prefix, suffix } = frameworkConfig.interpolation
  if (!value.includes(prefix)) return
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = escaped.replace(new RegExp(`${escapedPrefix}[^}]+${escapedSuffix}`, 'g'), '.+')
  ...
}
```

- [ ] **Step 3: Test in browser**

1. Start server against an i18next project: `node dist/cli.js ./locales`
2. Open the app in Chrome with the extension active
3. Verify interpolated strings like "Hello, {{name}}" still match "Hello, John"
4. Verify `/api/config` returns framework info in Network tab

- [ ] **Step 4: Commit**

```bash
git add extension/content.js
git commit -m "feat: dynamic interpolation matching based on detected framework"
```

---

### Task 5: Update Roadmap

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Mark the item as complete and add to v7 section**

Move "Auto-detect i18n framework" from Ideas to a new v7 section:

```markdown
## v7
- [x] Auto-detect i18n framework (i18next, react-intl, next-intl, vue-i18n, ngx-translate)
  - [x] Framework detection from project's package.json
  - [x] Smarter locales directory suggestions in onboarding
  - [x] Dynamic interpolation matching in extension ({{var}} vs {var})
  - [x] Framework info displayed in CLI and exposed via /api/config
```

- [ ] **Step 2: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark auto-detect i18n framework as complete in roadmap"
```
