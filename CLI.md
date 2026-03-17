# LangLens CLI

## Commands

### `langlens` — Start the dev server

```bash
npx langlens [locales-dir] [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `locales-dir` | Path to locale files | `./locales` |
| `--port, -p` | Server port | `5567` |
| `--help, -h` | Show help | |
| `--version, -v` | Show version | |

```bash
npx langlens ./src/locales
npx langlens ./src/locales --port 3456
```

On first run with no arguments, LangLens runs an interactive setup wizard that detects your i18n framework and saves config to `.langlensrc.json`.

---

### `langlens coverage` — Check translation coverage

Compares source and target locale files. Exits with code 1 if coverage is below threshold — useful for CI.

```bash
npx langlens coverage [locales-dir] [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `locales-dir` | Path to locale files | `./locales` |
| `--source, -s` | Source language | `en` |
| `--target, -t` | Target language | `he` |
| `--threshold` | Minimum coverage % to pass | `0` |
| `--verbose` | Show missing keys per namespace | |

```bash
npx langlens coverage ./src/locales --target fr --threshold 90
npx langlens coverage ./src/locales --target he --verbose
```

Sample output:
```
LangLens — Translation Coverage Report
══════════════════════════════════════════

  ✓ common     [███████████████] 100% (144/144)
  ◐ dashboard  [██████████████░]  95% (190/200)
  ✗ marketing  [████░░░░░░░░░░░]  26% (116/441)

──────────────────────────────────────────
  Total: 82% (450/785 keys)
  Missing: 335 keys
```

---

### `langlens scan` — Scan source files for hardcoded strings

Walks your source directory and finds strings that should be wrapped in `t()` calls. Exits with code 1 if hardcoded count exceeds threshold.

```bash
npx langlens scan [src-dir] [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `src-dir` | Path to source files | `./locales` |
| `--ext` | File extensions to scan (comma-separated) | `tsx,ts,jsx,js` |
| `--threshold` | Max hardcoded strings allowed | `0` |
| `--verbose` | Show all hardcoded strings per file | |

```bash
npx langlens scan ./src --verbose
npx langlens scan ./src --ext tsx --threshold 0
```

Sample output:
```
LangLens — Hardcoded String Scan
══════════════════════════════════════════

  Scanned: 120 files
  Issues:  8 files with hardcoded strings
  Total:   42 hardcoded strings found

──────────────────────────────────────────

  ✗ src/pages/settings.tsx (12)
      L49 [JSX] "General Settings"
      L55 [prop] "Enter your name"
      L89 [toast] "Settings saved"

  ◐ src/components/header.tsx (3)
      L22 [JSX] "Welcome back"
      L31 [aria] "Open menu"
```

**Detects:**
- JSX text content — `>Some Text<`
- String props — `title="..."`, `placeholder="..."`, `label="..."`, `description="..."`, `alt="..."`
- Toast messages — `toast.success("...")`, `toast.error("...")`
- Confirm dialogs — `confirm("...")`, `window.confirm("...")`
- Aria labels — `aria-label="..."`

**Ignores:**
- Strings already on lines with `t()` calls
- URLs, hex colors, CSS values, constants
- Import statements and comments
- Short strings (< 2 characters)
- Technical identifiers (kebab-case, snake_case, UPPER_CASE)

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LANGLENS_LOCALES_DIR` | Default locales directory |
| `LANGLENS_PORT` | Default server port |

---

## CI Integration

```yaml
# GitHub Actions example
- name: Check translation coverage
  run: npx langlens coverage ./src/locales --target fr --threshold 90

- name: Check for hardcoded strings
  run: npx langlens scan ./src --threshold 0
```
