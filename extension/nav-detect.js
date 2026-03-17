/**
 * LangLens — SPA navigation detector
 *
 * Runs in the page's MAIN world (not the isolated content script world)
 * so it can intercept the real pushState/replaceState calls.
 * Fires a custom event that the content script listens to.
 */
;(() => {
  const origPushState = history.pushState.bind(history)
  const origReplaceState = history.replaceState.bind(history)

  history.pushState = (...args) => {
    origPushState(...args)
    window.dispatchEvent(new Event('langlens:nav'))
  }

  history.replaceState = (...args) => {
    origReplaceState(...args)
    window.dispatchEvent(new Event('langlens:nav'))
  }
})()
