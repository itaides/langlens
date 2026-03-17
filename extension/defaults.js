/**
 * Shared configuration defaults for LangLens.
 *
 * Used by popup.js (imported via <script>).
 * content.js cannot use ES modules in a Chrome extension content script,
 * so it keeps its own copy of these defaults — they must stay in sync.
 */
const DEFAULTS = {
  backendUrl: 'http://localhost:5567',
  appUrl: 'http://localhost:5555',
  sourceLang: 'en',
  targetLang: 'he',
}
