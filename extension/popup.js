// DEFAULTS is loaded from defaults.js via a <script> tag in popup.html.

const FIELDS = ['backendUrl', 'appUrl', 'sourceLang', 'targetLang']

// Use chrome.storage.sync so settings persist across devices
chrome.storage.sync.get('llConfig', ({ llConfig }) => {
  const config = { ...DEFAULTS, ...llConfig }
  for (const field of FIELDS) {
    document.getElementById(field).value = config[field]
  }
})

document.getElementById('saveBtn').addEventListener('click', () => {
  const config = {}
  for (const field of FIELDS) {
    config[field] =
      document.getElementById(field).value.trim() || DEFAULTS[field]
  }

  const status = document.getElementById('status')

  chrome.storage.sync.set({ llConfig: config }, () => {
    if (chrome.runtime.lastError) {
      status.textContent = 'Error saving settings'
      status.className = 'status status-err'
      return
    }

    status.textContent = 'Settings saved! Reload your app page.'
    status.className = 'status status-ok'
    setTimeout(() => {
      status.textContent = ''
    }, 3000)
  })
})
