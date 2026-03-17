/**
 * LangLens — Chrome Extension Content Script
 *
 * Two modes:
 *   1. Edit mode — hover + click to edit individual strings
 *   2. Scanner — side panel listing ALL strings on the current page
 */

// Mode & filter constants
const MODES = { EDIT: 'edit', SCAN: 'scan' }
const FILTERS = {
  ALL: 'all',
  MISSING: 'missing',
  HARDCODED: 'hardcoded',
  TRANSLATED: 'translated',
}

// Config (loaded from chrome.storage, with defaults)
const DEFAULTS = {
  backendUrl: 'http://localhost:5567',
  appUrl: 'http://localhost:5555',
  sourceLang: 'en',
  targetLang: 'he',
}

let config = { ...DEFAULTS }

// State
let activeMode = null // null | MODES.EDIT | MODES.SCAN
const translations = {}
const reverseMap = new Map()
let availableLangs = []
let frameworkConfig = { interpolation: { prefix: '{{', suffix: '}}' } }
let currentOverlay = null
let currentHighlight = null
let modeBanner = null
let scannerPanel = null
let toggleBtn = null
let _renderList = null
let _rescan = null
let groupDropdownClickHandler = null
let scannerStats = {
  total: 0,
  hardcoded: 0,
  missing: 0,
  translated: 0,
  i18nStrings: 0,
  coveragePct: 100,
}

// ─── Flatten / Unflatten ────────────────────────────────────

function flattenJson(obj, prefix = '') {
  const result = {}
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenJson(value, fullKey))
    } else {
      // Preserve original type — avoids corrupting arrays, numbers, booleans, null
      result[fullKey] = value
    }
  }
  return result
}

function unflattenJson(flat) {
  const result = {}
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.')
    let current = result
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current)) current[parts[i]] = {}
      current = current[parts[i]]
    }
    current[parts[parts.length - 1]] = value
  }
  return result
}

// ─── Load Translations ──────────────────────────────────────

async function loadTranslations() {
  const { backendUrl, sourceLang, targetLang } = config
  try {
    // Fetch framework config (interpolation pattern, etc.)
    try {
      const cfgRes = await fetch(`${backendUrl}/api/config`)
      const cfgData = await cfgRes.json()
      if (cfgData.framework?.interpolation) {
        frameworkConfig = cfgData.framework
      }
    } catch (_) {
      /* use defaults */
    }

    const nsRes = await fetch(`${backendUrl}/api/namespaces`)
    const namespaces = await nsRes.json()

    const results = await Promise.all(
      namespaces.map(async (ns) => {
        const res = await fetch(`${backendUrl}/api/translations/${ns}`)
        const data = await res.json()
        return { ns, data }
      }),
    )

    for (const { ns, data } of results) {
      translations[ns] = {
        source: flattenJson(data[sourceLang] || {}),
        target: flattenJson(data[targetLang] || {}),
      }
      // Derive available languages from the first namespace response
      if (availableLangs.length === 0) {
        availableLangs = Object.keys(data).sort()
      }
    }

    buildReverseMap()
    console.log(
      `[LangLens] Loaded translations (${sourceLang} → ${targetLang}), reverse map size:`,
      reverseMap.size,
    )
  } catch (err) {
    console.error(
      `[LangLens] Failed to load translations. Is the backend running at ${backendUrl}?`,
      err,
    )
  }
}

// Fuzzy patterns for strings with interpolated variables
let fuzzyPatterns = [] // { regex, match }

function addFuzzyPattern(value, entry) {
  const { prefix, suffix } = frameworkConfig.interpolation
  if (!value.includes(prefix)) return
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = escaped.replace(
    new RegExp(`${escapedPrefix}[^}]+${escapedSuffix}`, 'g'),
    '.+',
  )
  try {
    fuzzyPatterns.push({ regex: new RegExp(`^${pattern}$`), match: entry })
  } catch (_) {
    /* invalid regex, skip */
  }
}

function buildReverseMap() {
  reverseMap.clear()
  fuzzyPatterns = []

  for (const [ns, { source, target }] of Object.entries(translations)) {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value !== 'string' || value.length <= 1) continue
      const normalized = normalizeText(value)
      const targetVal = typeof target[key] === 'string' ? target[key] : ''
      const entry = { namespace: ns, key, source: value, target: targetVal }

      if (!reverseMap.has(normalized)) {
        reverseMap.set(normalized, entry)
      }

      addFuzzyPattern(value, entry)
    }
    for (const [key, value] of Object.entries(target)) {
      if (typeof value !== 'string' || value.length <= 1) continue
      const normalized = normalizeText(value)
      const sourceVal = typeof source[key] === 'string' ? source[key] : ''
      const entry = { namespace: ns, key, source: sourceVal, target: value }
      if (!reverseMap.has(normalized)) {
        reverseMap.set(normalized, entry)
      }

      addFuzzyPattern(value, entry)
    }
  }
}

function fuzzyMatch(text) {
  for (const { regex, match } of fuzzyPatterns) {
    if (regex.test(text)) return match
  }
  return null
}

function normalizeText(text) {
  return text.trim().replace(/\s+/g, ' ')
}

const RTL_LANGS = new Set(['he', 'ar', 'fa', 'ur', 'yi'])
function isRTL(lang) {
  return RTL_LANGS.has(lang.toLowerCase())
}

// ─── Find Translation Key for Element ───────────────────────

function findTranslation(text) {
  if (!text || text.length <= 1) return null
  const normalized = normalizeText(text)

  // Exact match
  if (reverseMap.has(normalized)) return reverseMap.get(normalized)

  // Fuzzy match (interpolated variables)
  const fuzzy = fuzzyMatch(normalized)
  if (fuzzy) return fuzzy

  return null
}

function findTranslationForElement(el) {
  const text = el.textContent?.trim()
  const match = findTranslation(text)
  if (match) return match

  const ownText = getOwnText(el)
  return findTranslation(ownText)
}

function getOwnText(el) {
  let text = ''
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent
  }
  return text.trim()
}

// ─── Helpers ────────────────────────────────────────────────

function createEl(tag, className, textContent) {
  const el = document.createElement(tag)
  if (className) el.className = className
  if (textContent) el.textContent = textContent
  return el
}

const INTERACTIVE_SELECTOR =
  'a, button, select, option, input, textarea, label, [role="button"], [role="menuitem"], [role="tab"], [role="switch"], [role="combobox"], [role="listbox"], [role="option"]'

// ─── Edit Mode Overlay ──────────────────────────────────────

function showOverlay(el, match) {
  removeOverlay()

  const rect = el.getBoundingClientRect()
  const overlay = document.createElement('div')
  overlay.className = 'le-overlay'

  const keyBadge = createEl(
    'div',
    'le-overlay-key',
    `${match.namespace}:${match.key}`,
  )
  overlay.appendChild(keyBadge)
  if (!match.target)
    keyBadge.appendChild(createEl('span', 'le-missing-badge', 'Missing'))

  const enSection = createEl('div', 'le-overlay-section')
  enSection.appendChild(
    createEl(
      'div',
      'le-overlay-label',
      `Source (${config.sourceLang.toUpperCase()})`,
    ),
  )
  enSection.appendChild(createEl('div', 'le-overlay-value', match.source))
  overlay.appendChild(enSection)

  overlay.appendChild(createEl('div', 'le-overlay-divider'))

  const heSection = createEl('div', 'le-overlay-section')
  heSection.appendChild(
    createEl(
      'div',
      'le-overlay-label',
      `Target (${config.targetLang.toUpperCase()})`,
    ),
  )

  const input = document.createElement('input')
  input.className = 'le-overlay-input'
  input.type = 'text'
  if (isRTL(config.targetLang)) input.dir = 'rtl'
  input.value = match.target
  input.placeholder = `Enter ${config.targetLang.toUpperCase()} translation...`
  heSection.appendChild(input)

  // AI suggest in overlay (Chrome Translator API)
  if (chromeTranslator && !match.target) {
    const suggestBtn = createEl(
      'button',
      'le-overlay-btn le-overlay-btn-suggest',
      'Suggest with AI',
    )
    suggestBtn.addEventListener('click', async () => {
      suggestBtn.textContent = 'Translating...'
      const suggestion = await suggestTranslation(match.source)
      if (suggestion) {
        input.value = suggestion
        input.focus()
      }
      suggestBtn.textContent = 'Suggest with AI'
    })
    heSection.appendChild(suggestBtn)
  }

  const hint = createEl('div', 'le-overlay-hint')
  const enterHint = document.createElement('span')
  enterHint.appendChild(createEl('kbd', null, 'Enter'))
  enterHint.appendChild(document.createTextNode(' to save'))
  hint.appendChild(enterHint)
  const escHint = document.createElement('span')
  escHint.appendChild(createEl('kbd', null, 'Esc'))
  escHint.appendChild(document.createTextNode(' to cancel'))
  hint.appendChild(escHint)
  heSection.appendChild(hint)
  overlay.appendChild(heSection)

  const actions = createEl('div', 'le-overlay-actions')
  const cancelBtn = createEl(
    'button',
    'le-overlay-btn le-overlay-btn-cancel',
    'Cancel',
  )
  cancelBtn.addEventListener('click', () => removeOverlay())
  actions.appendChild(cancelBtn)
  const saveBtn = createEl(
    'button',
    'le-overlay-btn le-overlay-btn-save',
    'Save',
  )
  saveBtn.addEventListener('click', async () => {
    await saveTranslation(match.namespace, match.key, input.value, statusEl)
  })
  actions.appendChild(saveBtn)
  overlay.appendChild(actions)

  const statusEl = createEl('div', 'le-overlay-status')
  statusEl.style.display = 'none'
  overlay.appendChild(statusEl)

  const top = rect.bottom + 8
  const left = Math.min(rect.left, window.innerWidth - 420)
  overlay.style.top = `${top}px`
  overlay.style.left = `${Math.max(8, left)}px`
  if (top + 280 > window.innerHeight) overlay.style.top = `${rect.top - 280}px`

  document.body.appendChild(overlay)
  currentOverlay = overlay
  input.focus()
  input.select()

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter')
      await saveTranslation(match.namespace, match.key, input.value, statusEl)
    if (e.key === 'Escape') removeOverlay()
  })

  overlay.addEventListener('click', (e) => e.stopPropagation())
}

function removeOverlay() {
  if (currentOverlay) {
    const overlay = currentOverlay
    currentOverlay = null
    overlay.classList.add('le-overlay-closing')
    overlay.style.pointerEvents = 'none'
    overlay.addEventListener('animationend', () => overlay.remove())
  }
  if (currentHighlight) {
    currentHighlight.classList.remove('le-highlight')
    currentHighlight = null
  }
}

// ─── Save Translation ───────────────────────────────────────

async function persistTranslation(namespace, langType, key, newValue) {
  const lang = langType === 'source' ? config.sourceLang : config.targetLang
  translations[namespace][langType][key] = newValue
  buildReverseMap()

  const nested = unflattenJson(translations[namespace][langType])
  const res = await fetch(
    `${config.backendUrl}/api/translations/${namespace}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [lang]: nested }),
    },
  )

  return res.ok
}

async function saveTranslation(namespace, key, newValue, statusEl) {
  try {
    const ok = await persistTranslation(namespace, 'target', key, newValue)

    if (ok) {
      statusEl.textContent = '\u2728 Saved!'
      statusEl.style.display = 'block'
      const overlayRef = currentOverlay
      miniConfetti(overlayRef)
      setTimeout(() => removeOverlay(), 1000)

      // Refresh scanner if open
      if (scannerPanel) refreshScanner()
    } else {
      statusEl.textContent = 'Error saving'
      statusEl.style.color = 'var(--le-danger)'
      statusEl.style.display = 'block'
    }
  } catch (err) {
    statusEl.textContent = 'Backend not reachable'
    statusEl.style.color = 'var(--le-danger)'
    statusEl.style.display = 'block'
  }
}

// ─── Mini Confetti ──────────────────────────────────────────

function miniConfetti(anchor) {
  if (!anchor) return
  const rect = anchor.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2

  const colors = [
    '#4f46e5',
    '#06b6d4',
    '#f59e0b',
    '#10b981',
    '#ec4899',
    '#8b5cf6',
    '#f43f5e',
    '#facc15',
    '#34d399',
  ]
  const shapes = [
    'le-confetti',
    'le-confetti le-confetti-circle',
    'le-confetti le-confetti-star',
  ]
  const count = 120

  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div')
    dot.className = shapes[i % shapes.length]
    dot.style.left = `${cx + (Math.random() - 0.5) * 20}px`
    dot.style.top = `${cy + (Math.random() - 0.5) * 20}px`
    dot.style.background = colors[i % colors.length]

    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.8
    const velocity = 160 + Math.random() * 200
    const dx = Math.cos(angle) * velocity
    const dy = Math.sin(angle) * velocity - 50

    dot.style.setProperty('--dx', `${dx}px`)
    dot.style.setProperty('--dy', `${dy}px`)
    dot.style.setProperty('--rot', `${Math.random() * 720}deg`)
    dot.style.animationDuration = `${0.6 + Math.random() * 0.5}s`

    document.body.appendChild(dot)
    dot.addEventListener('animationend', () => dot.remove())
  }
}

// ─── Edit Mode Event Handlers ───────────────────────────────

function onMouseOver(e) {
  if (activeMode !== MODES.EDIT || currentOverlay) return
  const el = e.target
  if (
    el.closest('.le-overlay') ||
    el.closest('.le-toggle') ||
    el.closest('.le-scanner')
  )
    return
  if (el.matches(INTERACTIVE_SELECTOR) || el.closest(INTERACTIVE_SELECTOR))
    return

  const match = findTranslationForElement(el)
  if (match) {
    el.classList.add('le-highlight')
    currentHighlight = el
  }
}

function onMouseOut(e) {
  if (activeMode !== MODES.EDIT || currentOverlay) return
  const el = e.target
  el.classList.remove('le-highlight')
  if (currentHighlight === el) currentHighlight = null
}

function onClick(e) {
  if (activeMode !== MODES.EDIT) return
  const el = e.target
  if (
    el.closest('.le-overlay') ||
    el.closest('.le-toggle') ||
    el.closest('.le-scanner')
  )
    return
  if (el.matches(INTERACTIVE_SELECTOR) || el.closest(INTERACTIVE_SELECTOR))
    return

  const match = findTranslationForElement(el)
  if (match) {
    e.preventDefault()
    e.stopPropagation()
    showOverlay(el, match)
  }
}

document.addEventListener('click', (e) => {
  if (currentOverlay && !e.target.closest('.le-overlay')) removeOverlay()
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (currentOverlay) removeOverlay()
  }
})

// ═══════════════════════════════════════════════════════════════
// MODE 2: PAGE SCANNER
// ═══════════════════════════════════════════════════════════════

// Strings that are clearly not translatable content
const SKIP_PATTERNS =
  /^[\d\s.,;:!?@#$%^&*()\-+=<>{}[\]|/\\'"~`]+$|^https?:|^\d+$/
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'SVG',
  'PATH',
  'CODE',
  'PRE',
  'NOSCRIPT',
  'LINK',
  'META',
])

function isLikelyHumanText(text) {
  if (text.length <= 2) return false
  if (SKIP_PATTERNS.test(text)) return false
  // Must contain at least one letter
  if (!/[a-zA-Z\u0590-\u05FF\u0600-\u06FF]/.test(text)) return false
  return true
}

function scanPageStrings() {
  const found = new Map() // key → { match, elements[], hardcoded }
  const seenHardcoded = new Set() // deduplicate hardcoded text

  // Walk all text-containing elements
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT
        if (
          node.closest('.le-scanner') ||
          node.closest('.le-toggle') ||
          node.closest('.le-overlay') ||
          node.closest('.le-mode-banner')
        ) {
          return NodeFilter.FILTER_REJECT
        }
        return NodeFilter.FILTER_ACCEPT
      },
    },
  )

  let node = walker.nextNode()
  while (node) {
    const ownText = getOwnText(node)
    if (ownText && ownText.length > 1) {
      addTextToFound(ownText, node, found, seenHardcoded)

      // Scan translatable attributes
      for (const attr of TRANSLATABLE_ATTRS) {
        const attrVal = node.getAttribute(attr)
        if (attrVal && attrVal.length > 1) {
          addTextToFound(attrVal, node, found, seenHardcoded)
        }
      }
    }
    node = walker.nextNode()
  }

  // Also check textContent of elements (catches composed text)
  const allEls = document.body.querySelectorAll(
    '*:not(.le-scanner):not(.le-scanner *):not(.le-toggle):not(.le-overlay):not(.le-overlay *):not(.le-mode-banner)',
  )
  for (const el of allEls) {
    if (SKIP_TAGS.has(el.tagName)) continue
    const text = el.textContent?.trim()
    if (!text || text.length <= 1) continue

    const normalized = normalizeText(text)
    const match = findTranslation(text)
    if (match) {
      const mapKey = `${match.namespace}:${match.key}`
      if (!found.has(mapKey)) {
        found.set(mapKey, { match, elements: [el], hardcoded: false })
      }
    }
  }

  return Array.from(found.values())
}

const TRANSLATABLE_ATTRS = ['placeholder', 'aria-label', 'title', 'alt']

function addTextToFound(text, element, found, seenHardcoded) {
  const normalized = normalizeText(text)
  const match = findTranslation(text)

  if (match) {
    const mapKey = `${match.namespace}:${match.key}`
    if (!found.has(mapKey)) {
      found.set(mapKey, { match, elements: [], hardcoded: false })
    }
    found.get(mapKey).elements.push(element)
  } else if (isLikelyHumanText(text) && !seenHardcoded.has(normalized)) {
    seenHardcoded.add(normalized)
    const hardcodedKey = `__hardcoded__:${normalized.slice(0, 60)}`
    found.set(hardcodedKey, {
      match: { namespace: '', key: '', source: text, target: '' },
      elements: [element],
      hardcoded: true,
    })
  }
}

function showScanner() {
  hideScanner()

  scannerPanel = document.createElement('div')
  scannerPanel.className = 'le-scanner'

  // Header
  const header = createEl('div', 'le-scanner-header')
  const headerLeft = createEl('div', 'le-scanner-header-left')
  headerLeft.appendChild(createEl('div', 'le-scanner-title', 'Page Strings'))

  // Language switcher
  const langSwitcher = createEl('div', 'le-scanner-lang-switcher')
  const langLabel = createEl(
    'span',
    'le-scanner-lang-label',
    `${config.sourceLang.toUpperCase()} \u2192`,
  )
  langSwitcher.appendChild(langLabel)

  const langSelect = document.createElement('select')
  langSelect.className = 'le-scanner-lang-select'

  // Populate target languages from cached availableLangs
  for (const lang of availableLangs) {
    if (lang === config.sourceLang) continue
    const opt = document.createElement('option')
    opt.value = lang
    opt.textContent = lang.toUpperCase()
    if (lang === config.targetLang) opt.selected = true
    langSelect.appendChild(opt)
  }

  langSelect.addEventListener('change', async () => {
    config.targetLang = langSelect.value
    chrome.storage.sync.set({ llConfig: config })
    await loadTranslations()
    if (chromeTranslator) {
      await initTranslatorAPI()
    }
    scannedItems = scanPageStrings()
    computeStats()
    buildGroupDropdown()
    renderList()
  })

  langSwitcher.appendChild(langSelect)
  headerLeft.appendChild(langSwitcher)
  header.appendChild(headerLeft)

  // Header actions (export/import + close)
  const headerActions = createEl('div', 'le-scanner-header-actions')

  const exportBtn = createEl('button', 'le-scanner-action-btn', 'Export')
  exportBtn.title = 'Export missing/all strings as JSON'
  exportBtn.addEventListener('click', () =>
    exportStrings(scannedItems, activeFilter),
  )
  headerActions.appendChild(exportBtn)

  const importBtn = createEl('button', 'le-scanner-action-btn', 'Import')
  importBtn.title = 'Import translations from JSON file'
  importBtn.addEventListener('click', () => importStrings())
  headerActions.appendChild(importBtn)

  const closeBtn = createEl('button', 'le-scanner-close', '\u00D7')
  closeBtn.addEventListener('click', () => setMode(null))
  headerActions.appendChild(closeBtn)

  header.appendChild(headerActions)
  scannerPanel.appendChild(header)

  // Stats bar
  const statsBar = createEl('div', 'le-scanner-stats')
  scannerPanel.appendChild(statsBar)

  // Filter bar
  const filterBar = createEl('div', 'le-scanner-filters')
  const filters = [
    FILTERS.ALL,
    FILTERS.MISSING,
    FILTERS.HARDCODED,
    FILTERS.TRANSLATED,
  ]
  let activeFilter = FILTERS.ALL

  for (const f of filters) {
    const btn = createEl(
      'button',
      'le-scanner-filter-btn',
      f.charAt(0).toUpperCase() + f.slice(1),
    )
    if (f === FILTERS.ALL) btn.classList.add('le-scanner-filter-active')
    btn.dataset.filter = f
    btn.addEventListener('click', () => {
      activeFilter = f
      for (const b of filterBar.querySelectorAll('.le-scanner-filter-btn')) {
        b.classList.remove('le-scanner-filter-active')
      }
      btn.classList.add('le-scanner-filter-active')
      renderList()
    })
    filterBar.appendChild(btn)
  }
  scannerPanel.appendChild(filterBar)

  // Search + Group filter row
  const searchRow = createEl('div', 'le-scanner-search-row')

  const searchInput = document.createElement('input')
  searchInput.className = 'le-scanner-search'
  searchInput.type = 'text'
  searchInput.placeholder = 'Search strings...'
  let searchDebounceTimer = null
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = setTimeout(() => renderList(), 150)
  })
  searchRow.appendChild(searchInput)

  // Group filter dropdown (multi-select)
  const groupWrap = createEl('div', 'le-scanner-group-wrap')
  const groupBtn = createEl('button', 'le-scanner-group-btn', 'Groups')
  const groupDropdown = createEl('div', 'le-scanner-group-dropdown')
  groupDropdown.style.display = 'none'
  const selectedGroups = new Set() // empty = all

  groupBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    const isOpen = groupDropdown.style.display !== 'none'
    groupDropdown.style.display = isOpen ? 'none' : 'block'
  })

  groupWrap.appendChild(groupBtn)
  groupWrap.appendChild(groupDropdown)
  searchRow.appendChild(groupWrap)

  scannerPanel.appendChild(searchRow)

  // List container
  const listContainer = createEl('div', 'le-scanner-list')
  scannerPanel.appendChild(listContainer)

  // Close group dropdown when clicking outside
  groupDropdownClickHandler = (e) => {
    if (!e.target.closest('.le-scanner-group-wrap')) {
      groupDropdown.style.display = 'none'
    }
  }
  document.addEventListener('click', groupDropdownClickHandler)

  document.body.appendChild(scannerPanel)

  // Scan and render
  let scannedItems = scanPageStrings()

  // Build group list from scanned items
  function buildGroupDropdown() {
    groupDropdown.replaceChildren()

    const groups = new Map() // group → count
    for (const item of scannedItems) {
      if (item.hardcoded) {
        const g = '(hardcoded)'
        groups.set(g, (groups.get(g) || 0) + 1)
      } else {
        const key = item.match.key
        const g = key.includes('.') ? key.split('.')[0] : '(root)'
        groups.set(g, (groups.get(g) || 0) + 1)
      }
    }

    // "All" option
    const allRow = createEl('label', 'le-scanner-group-option')
    const allCb = document.createElement('input')
    allCb.type = 'checkbox'
    allCb.checked = selectedGroups.size === 0
    allCb.addEventListener('change', () => {
      selectedGroups.clear()
      buildGroupDropdown()
      renderList()
      updateGroupBtnLabel()
    })
    allRow.appendChild(allCb)
    allRow.appendChild(createEl('span', null, `All (${scannedItems.length})`))
    groupDropdown.appendChild(allRow)

    // Divider
    groupDropdown.appendChild(createEl('div', 'le-scanner-group-divider'))

    // Each group
    const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    for (const [group, count] of sortedGroups) {
      const row = createEl('label', 'le-scanner-group-option')
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = selectedGroups.size === 0 || selectedGroups.has(group)
      cb.addEventListener('change', () => {
        if (cb.checked) {
          selectedGroups.add(group)
        } else {
          selectedGroups.delete(group)
        }
        // If all are selected, clear to mean "all"
        if (selectedGroups.size === groups.size) {
          selectedGroups.clear()
        }
        renderList()
        updateGroupBtnLabel()
      })
      row.appendChild(cb)
      row.appendChild(createEl('span', null, `${group} (${count})`))
      groupDropdown.appendChild(row)
    }
  }

  function updateGroupBtnLabel() {
    if (selectedGroups.size === 0) {
      groupBtn.textContent = 'Groups'
      groupBtn.classList.remove('le-scanner-group-btn-active')
    } else {
      groupBtn.textContent = `Groups (${selectedGroups.size})`
      groupBtn.classList.add('le-scanner-group-btn-active')
    }
  }

  function getItemGroup(item) {
    if (item.hardcoded) return '(hardcoded)'
    const key = item.match.key
    return key.includes('.') ? key.split('.')[0] : '(root)'
  }

  buildGroupDropdown()

  function computeStats() {
    const total = scannedItems.length
    const hardcoded = scannedItems.filter((i) => i.hardcoded).length
    const missing = scannedItems.filter(
      (i) => !i.hardcoded && !i.match.target,
    ).length
    const translated = total - missing - hardcoded
    const i18nStrings = total - hardcoded
    const coveragePct =
      i18nStrings > 0 ? Math.round((translated / i18nStrings) * 100) : 100
    scannerStats = {
      total,
      hardcoded,
      missing,
      translated,
      i18nStrings,
      coveragePct,
    }
  }

  function renderList() {
    listContainer.replaceChildren()
    const query = searchInput.value.toLowerCase()

    let items = scannedItems
    if (activeFilter === FILTERS.MISSING) {
      items = items.filter((i) => !i.hardcoded && !i.match.target)
    } else if (activeFilter === FILTERS.TRANSLATED) {
      items = items.filter(
        (i) =>
          !i.hardcoded && i.match.target && i.match.target !== i.match.source,
      )
    } else if (activeFilter === FILTERS.HARDCODED) {
      items = items.filter((i) => i.hardcoded)
    }

    // Group filter
    if (selectedGroups.size > 0) {
      items = items.filter((i) => selectedGroups.has(getItemGroup(i)))
    }

    if (query) {
      items = items.filter(
        (i) =>
          i.match.key.toLowerCase().includes(query) ||
          i.match.source.toLowerCase().includes(query) ||
          i.match.target.toLowerCase().includes(query),
      )
    }

    // Sort: hardcoded first, then missing, then translated
    items.sort((a, b) => {
      const aScore = a.hardcoded ? 0 : a.match.target ? 2 : 1
      const bScore = b.hardcoded ? 0 : b.match.target ? 2 : 1
      return aScore - bScore || a.match.source.localeCompare(b.match.source)
    })

    // Render pre-computed stats
    const { total, hardcoded, missing, translated, coveragePct } = scannerStats
    statsBar.textContent = ''
    statsBar.appendChild(
      createEl(
        'span',
        'le-scanner-stat le-scanner-stat-coverage',
        `${coveragePct}%`,
      ),
    )
    statsBar.appendChild(
      createEl('span', 'le-scanner-stat', `${total} strings`),
    )
    statsBar.appendChild(
      createEl(
        'span',
        'le-scanner-stat le-scanner-stat-ok',
        `${translated} translated`,
      ),
    )
    if (missing > 0) {
      statsBar.appendChild(
        createEl(
          'span',
          'le-scanner-stat le-scanner-stat-miss',
          `${missing} missing`,
        ),
      )
    }
    if (hardcoded > 0) {
      statsBar.appendChild(
        createEl(
          'span',
          'le-scanner-stat le-scanner-stat-hard',
          `${hardcoded} hardcoded`,
        ),
      )
    }

    if (items.length === 0) {
      const emptyMsg =
        activeFilter === FILTERS.MISSING
          ? 'No missing strings on this page!'
          : activeFilter === FILTERS.HARDCODED
            ? 'No hardcoded strings detected!'
            : 'No matches'
      listContainer.appendChild(createEl('div', 'le-scanner-empty', emptyMsg))
      return
    }

    for (const item of items) {
      // Hardcoded row — different layout
      if (item.hardcoded) {
        const row = createEl('div', 'le-scanner-row le-scanner-row-hardcoded')

        const headerRow = createEl('div', 'le-scanner-row-header')
        headerRow.appendChild(
          createEl('span', 'le-hardcoded-badge', 'Hardcoded'),
        )
        row.appendChild(headerRow)

        const textEl = createEl(
          'div',
          'le-scanner-row-hardcoded-text',
          item.match.source,
        )
        row.appendChild(textEl)

        const hintEl = createEl(
          'div',
          'le-scanner-row-hardcoded-hint',
          'This string is not using t() — needs developer attention',
        )
        row.appendChild(hintEl)

        // Locate button
        const locateBtn = createEl('button', 'le-scanner-row-locate', 'Locate')
        locateBtn.addEventListener('click', () => {
          const el = item.elements[0]
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            el.classList.add('le-highlight-hardcoded')
            setTimeout(
              () => el.classList.remove('le-highlight-hardcoded'),
              2000,
            )
          }
        })
        row.appendChild(locateBtn)

        listContainer.appendChild(row)
        continue
      }

      const row = createEl(
        'div',
        `le-scanner-row ${!item.match.target ? 'le-scanner-row-missing' : ''}`,
      )

      // Key
      row.appendChild(createEl('div', 'le-scanner-row-key', item.match.key))

      // EN (double-click to edit)
      const enRow = createEl('div', 'le-scanner-row-en')
      enRow.appendChild(
        createEl(
          'span',
          'le-scanner-row-lang',
          config.sourceLang.toUpperCase(),
        ),
      )

      const enText = createEl(
        'span',
        'le-scanner-row-en-text',
        item.match.source,
      )
      enText.title = 'Double-click to edit source'
      enRow.appendChild(enText)

      enText.addEventListener('dblclick', () => {
        const enInput = document.createElement('input')
        enInput.className = 'le-scanner-row-input le-scanner-row-input-en'
        enInput.type = 'text'
        enInput.value = item.match.source
        enText.replaceWith(enInput)
        enInput.focus()
        enInput.select()

        const enSaveIndicator = createEl('span', 'le-scanner-row-saved')
        enSaveIndicator.style.display = 'none'
        enRow.appendChild(enSaveIndicator)

        const enSaveBtn = createEl('button', 'le-scanner-row-save', 'Save')
        enRow.appendChild(enSaveBtn)

        const saveEn = async () => {
          await saveScannerRowSource(
            item.match.namespace,
            item.match.key,
            enInput.value,
            enSaveIndicator,
          )
          item.match.source = enInput.value
        }

        enInput.addEventListener('keydown', async (e) => {
          if (e.key === 'Enter') await saveEn()
          if (e.key === 'Escape') {
            // Revert to text
            enInput.replaceWith(enText)
            enSaveBtn.remove()
            enSaveIndicator.remove()
          }
        })
        enSaveBtn.addEventListener('click', saveEn)
      })

      row.appendChild(enRow)

      // HE editable
      const heRow = createEl('div', 'le-scanner-row-he')
      heRow.appendChild(
        createEl(
          'span',
          'le-scanner-row-lang',
          config.targetLang.toUpperCase(),
        ),
      )

      const heInput = document.createElement('input')
      heInput.className = 'le-scanner-row-input'
      heInput.type = 'text'
      if (isRTL(config.targetLang)) heInput.dir = 'rtl'
      heInput.value = item.match.target
      heInput.placeholder = 'Missing...'

      const saveIndicator = createEl('span', 'le-scanner-row-saved')
      saveIndicator.style.display = 'none'

      heInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          await saveScannerRow(
            item.match.namespace,
            item.match.key,
            heInput.value,
            saveIndicator,
            row,
          )
        }
      })

      const rowSaveBtn = createEl('button', 'le-scanner-row-save', 'Save')
      rowSaveBtn.addEventListener('click', async () => {
        await saveScannerRow(
          item.match.namespace,
          item.match.key,
          heInput.value,
          saveIndicator,
          row,
        )
      })

      heRow.appendChild(heInput)

      // AI suggest button (Chrome Translator API)
      if (chromeTranslator && !item.match.target) {
        const suggestBtn = createEl('button', 'le-scanner-row-suggest', 'AI')
        suggestBtn.title = 'Suggest translation with Chrome AI'
        suggestBtn.addEventListener('click', async () => {
          suggestBtn.textContent = '...'
          const suggestion = await suggestTranslation(item.match.source)
          if (suggestion) {
            heInput.value = suggestion
            heInput.focus()
          }
          suggestBtn.textContent = 'AI'
        })
        heRow.appendChild(suggestBtn)
      }

      heRow.appendChild(rowSaveBtn)
      heRow.appendChild(saveIndicator)
      row.appendChild(heRow)

      // Click to scroll to element
      const locateBtn = createEl('button', 'le-scanner-row-locate', 'Locate')
      locateBtn.addEventListener('click', () => {
        const el = item.elements[0]
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          el.classList.add('le-highlight')
          setTimeout(() => el.classList.remove('le-highlight'), 2000)
        }
      })
      row.appendChild(locateBtn)

      listContainer.appendChild(row)
    }
  }

  // Expose for refresh via module-level variables
  _renderList = renderList
  _rescan = () => {
    scannedItems = scanPageStrings()
    computeStats()
    renderList()
  }

  computeStats()
  renderList()
}

function refreshScanner() {
  if (scannerPanel && _rescan) {
    _rescan()
  }
}

async function saveScannerRow(namespace, key, newValue, indicator, row) {
  try {
    const ok = await persistTranslation(namespace, 'target', key, newValue)
    if (ok) {
      indicator.textContent = '\u2713'
      indicator.style.display = 'inline'
      row.classList.remove('le-scanner-row-missing')
      setTimeout(() => {
        if (indicator.isConnected) indicator.style.display = 'none'
      }, 1500)
    }
  } catch (err) {
    indicator.textContent = '\u2717'
    indicator.style.color = 'var(--le-danger)'
    indicator.style.display = 'inline'
  }
}

async function saveScannerRowSource(namespace, key, newValue, indicator) {
  try {
    const ok = await persistTranslation(namespace, 'source', key, newValue)
    if (ok) {
      indicator.textContent = '\u2713'
      indicator.style.display = 'inline'
      setTimeout(() => {
        if (indicator.isConnected) indicator.style.display = 'none'
      }, 1500)
    }
  } catch (err) {
    indicator.textContent = '\u2717'
    indicator.style.color = 'var(--le-danger)'
    indicator.style.display = 'inline'
  }
}

// ─── Export / Import ────────────────────────────────────────

function exportStrings(items, filter) {
  let exportItems = items
  if (filter === FILTERS.MISSING) {
    exportItems = items.filter((i) => !i.hardcoded && !i.match.target)
  } else if (filter === FILTERS.HARDCODED) {
    exportItems = items.filter((i) => i.hardcoded)
  }

  const exportData = exportItems.map((item) => ({
    key: item.match.key || null,
    namespace: item.match.namespace || null,
    [config.sourceLang]: item.match.source,
    [config.targetLang]: item.match.target || '',
    hardcoded: item.hardcoded || false,
  }))

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `langlens-export-${filter || FILTERS.ALL}-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function importStrings() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return

    try {
      const text = await file.text()
      const data = JSON.parse(text)

      if (!Array.isArray(data)) {
        console.error('[LangLens] Import: expected JSON array')
        return
      }

      let importCount = 0
      const namespacesToSave = new Set()

      for (const row of data) {
        if (!row.key || !row.namespace || row.hardcoded) continue
        const targetValue = row[config.targetLang]
        if (!targetValue) continue

        if (translations[row.namespace]?.target) {
          translations[row.namespace].target[row.key] = targetValue
          namespacesToSave.add(row.namespace)
          importCount++
        }
      }

      // Save all affected namespaces
      for (const ns of namespacesToSave) {
        const targetNested = unflattenJson(translations[ns].target)
        await fetch(`${config.backendUrl}/api/translations/${ns}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [config.targetLang]: targetNested }),
        })
      }

      buildReverseMap()
      if (scannerPanel) refreshScanner()
      console.log(
        `[LangLens] Imported ${importCount} translations across ${namespacesToSave.size} namespaces`,
      )
    } catch (err) {
      console.error('[LangLens] Import failed:', err)
    }
  })
  input.click()
}

function hideScanner() {
  if (groupDropdownClickHandler) {
    document.removeEventListener('click', groupDropdownClickHandler)
    groupDropdownClickHandler = null
  }
  if (scannerPanel) {
    scannerPanel.remove()
    scannerPanel = null
  }
  _renderList = null
  _rescan = null
}

// ═══════════════════════════════════════════════════════════════
// MODE CONTROL
// ═══════════════════════════════════════════════════════════════

function setMode(mode) {
  // Deactivate current mode
  if (activeMode === MODES.EDIT) {
    document.removeEventListener('mouseover', onMouseOver, true)
    document.removeEventListener('mouseout', onMouseOut, true)
    document.removeEventListener('click', onClick, true)
    removeOverlay()
    hideModeBanner()
  }
  if (activeMode === MODES.SCAN) {
    hideScanner()
    hideModeBanner()
  }

  // Toggle off if same mode
  if (activeMode === mode) {
    activeMode = null
    updateToggleUI()
    chrome.storage.session.set({ leMode: null })
    return
  }

  activeMode = mode

  if (mode === MODES.EDIT) {
    document.addEventListener('mouseover', onMouseOver, true)
    document.addEventListener('mouseout', onMouseOut, true)
    document.addEventListener('click', onClick, true)
    showModeBanner('Edit mode \u2014 hover over text to translate')
  }

  if (mode === MODES.SCAN) {
    showScanner()
    showModeBanner('Scanner \u2014 all page strings listed')
  }

  updateToggleUI()
  chrome.storage.session.set({ leMode: mode })
}

function updateToggleUI() {
  if (!toggleBtn) return
  const editBtn = toggleBtn.querySelector(`[data-mode="${MODES.EDIT}"]`)
  const scanBtn = toggleBtn.querySelector(`[data-mode="${MODES.SCAN}"]`)
  if (editBtn)
    editBtn.classList.toggle('le-toggle-mode-active', activeMode === MODES.EDIT)
  if (scanBtn)
    scanBtn.classList.toggle('le-toggle-mode-active', activeMode === MODES.SCAN)
  toggleBtn.classList.toggle('le-active', activeMode !== null)
}

// ─── Toggle Button (mode switcher) ──────────────────────────

function createToggleButton() {
  toggleBtn = document.createElement('div')
  toggleBtn.className = 'le-toggle'

  const dot = createEl('span', 'le-toggle-dot')
  toggleBtn.appendChild(dot)
  toggleBtn.appendChild(document.createTextNode(' '))

  const editBtn = createEl('button', 'le-toggle-mode', 'Edit')
  editBtn.dataset.mode = MODES.EDIT
  editBtn.addEventListener('click', () => setMode(MODES.EDIT))
  toggleBtn.appendChild(editBtn)

  const divider = createEl('span', 'le-toggle-divider', '|')
  toggleBtn.appendChild(divider)

  const scanBtn = createEl('button', 'le-toggle-mode', 'Scan')
  scanBtn.dataset.mode = MODES.SCAN
  scanBtn.addEventListener('click', () => setMode(MODES.SCAN))
  toggleBtn.appendChild(scanBtn)

  document.body.appendChild(toggleBtn)
}

// ─── Mode Banner ────────────────────────────────────────────

function showModeBanner(text) {
  hideModeBanner()
  modeBanner = document.createElement('div')
  modeBanner.className = 'le-mode-banner'

  const dot = createEl('span', 'le-mode-banner-dot')
  modeBanner.appendChild(dot)
  modeBanner.appendChild(document.createTextNode(text))

  document.body.appendChild(modeBanner)
}

function hideModeBanner() {
  if (modeBanner) {
    modeBanner.classList.add('le-mode-banner-closing')
    const banner = modeBanner
    modeBanner = null
    banner.addEventListener('animationend', () => banner.remove())
  }
}

// ─── Init ───────────────────────────────────────────────────

async function init() {
  // Load config from sync storage (persists across devices)
  const { llConfig } = await chrome.storage.sync.get('llConfig')
  config = { ...DEFAULTS, ...llConfig }

  // Only activate on configured app URL
  if (config.appUrl && !window.location.href.startsWith(config.appUrl)) {
    console.log(
      `[LangLens] Skipping — current URL doesn't match configured app URL (${config.appUrl})`,
    )
    return
  }

  console.log(
    `[LangLens] Initializing (${config.sourceLang} → ${config.targetLang})...`,
  )
  createToggleButton()
  await loadTranslations()

  // Check Chrome Translator API availability
  await initTranslatorAPI()

  // Restore mode from session storage (clears on browser restart)
  const { leMode } = await chrome.storage.session.get('leMode')
  if (leMode) setMode(leMode)

  // Listen for config changes from popup (no page reload needed)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.llConfig) {
      const newConfig = { ...DEFAULTS, ...changes.llConfig.newValue }
      const langChanged =
        newConfig.sourceLang !== config.sourceLang ||
        newConfig.targetLang !== config.targetLang
      config = newConfig
      if (langChanged) {
        loadTranslations().then(() => {
          if (scannerPanel) refreshScanner()
        })
      }
      console.log('[LangLens] Config updated from popup')
    }
  })

  // ─── SPA navigation detection ──────────────────────────────
  // Re-scan page strings when the URL changes without a full reload

  let lastUrl = location.href

  function onNavigation() {
    if (location.href === lastUrl) return
    lastUrl = location.href
    console.log(`[LangLens] Navigation detected → ${location.href}`)
    // Wait for DOM to settle after route change
    setTimeout(() => {
      if (scannerPanel) refreshScanner()
    }, 300)
  }

  // Intercept history.pushState and history.replaceState
  const origPushState = history.pushState.bind(history)
  const origReplaceState = history.replaceState.bind(history)

  history.pushState = (...args) => {
    origPushState(...args)
    onNavigation()
  }
  history.replaceState = (...args) => {
    origReplaceState(...args)
    onNavigation()
  }

  // Back/forward button
  window.addEventListener('popstate', onNavigation)

  console.log('[LangLens] Ready!', leMode ? `(${leMode} mode restored)` : '')
}

// ─── Chrome Translator API (on-device AI) ───────────────────

let chromeTranslator = null

async function initTranslatorAPI() {
  if (!('Translator' in self)) {
    console.log('[LangLens] Chrome Translator API not available')
    return
  }

  try {
    const availability = await Translator.availability({
      sourceLanguage: config.sourceLang,
      targetLanguage: config.targetLang,
    })

    if (availability === 'unavailable') {
      console.log('[LangLens] Translator API: language pair not supported')
      return
    }

    chromeTranslator = await Translator.create({
      sourceLanguage: config.sourceLang,
      targetLanguage: config.targetLang,
    })

    console.log(
      `[LangLens] Chrome Translator API ready (${config.sourceLang} → ${config.targetLang})`,
    )
  } catch (err) {
    console.log('[LangLens] Chrome Translator API init failed:', err.message)
  }
}

async function suggestTranslation(sourceText) {
  if (!chromeTranslator) return null
  try {
    return await chromeTranslator.translate(sourceText)
  } catch {
    return null
  }
}

init()
