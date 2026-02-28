/**
 * Client-side domviewer payload module.
 *
 * Captures the iframe's DOM on initial load, then tracks mutations in real time
 * using MutationObserver. Serialised snapshots and deltas are msgpack-encoded
 * and sent to the server as binary frames via sendBinary().
 *
 * Periodically re-collects stylesheets so that late-loading or dynamically
 * injected CSS is captured. Style collection is deduped — unchanged styles
 * produce no network traffic.
 *
 * Reconnect sync: on reconnect the server sends { type: "request-sync" } because
 * its state is ephemeral. We respond with a full snapshot to repopulate it.
 */
import { encodeMessage } from "../../shared/codec.js";
import { createSerializer } from "../serialize.js";

/** Isolated serialiser instance — separate from any other payload's instance. */
let serializer = null;

let observer = null;
let pendingMutations = [];
let flushInterval = null;
let _sendBinary = null;
let _log = null;
let _iframe = null;

/**
 * Encode a message object as JSON and send it as a binary frame.
 * No-op if the message is null (e.g. unchanged styles).
 * @param {object|null} msg
 */
function sendMsg(msg) {
  if (!msg || !_sendBinary) return;
  _sendBinary(encodeMessage(msg));
}

/**
 * Attach the MutationObserver to the iframe's document and perform an initial
 * full serialisation. Safe to call multiple times — disconnects any existing
 * observer before re-attaching.
 */
function attachToFrame() {
  let frameDoc;
  try {
    frameDoc = _iframe.contentDocument;
  } catch (_) {
    if (_log) _log("warn", "Cross-origin iframe, cannot access document");
    return;
  }
  if (!frameDoc || !frameDoc.documentElement) return;
  if (_log) _log("info", "Attached to iframe: " + (_iframe.contentWindow?.location?.href || "unknown"));

  if (observer) {
    observer.disconnect();
    observer = null;
  }
  pendingMutations = [];

  // Store base URL
  try {
    sendMsg(serializer.setBaseUrl(_iframe.contentWindow.location.href));
  } catch (_) {}

  // Full DOM serialisation → snapshot message
  sendMsg(serializer.serializeFull(frameDoc.documentElement));

  // Collect styles (async, sends meta message if styles found)
  serializer.collectStyles(frameDoc).then(sendMsg);

  observer = new MutationObserver((mutations) => {
    pendingMutations.push(...mutations);
  });

  observer.observe(frameDoc.documentElement, {
    childList: true,
    attributes: true,
    characterData: true,
    subtree: true,
  });
}

/**
 * Payload entry point. Called by the loader with the API context.
 * @param {object} params
 * @param {HTMLIFrameElement} params.iframe
 * @param {Function} params.sendBinary - Send a raw binary frame to the server.
 * @param {Function} params.on - Register a handler for server-dispatched messages.
 * @param {Function} params.log - Send a diagnostic log message to the server.
 */
export function init({ iframe, sendBinary, on, log }) {
  _sendBinary = sendBinary;
  _log = log;
  _iframe = iframe;

  serializer = createSerializer();

  if (_log) _log("info", "Domviewer payload initialized");

  // On reconnect the server's ephemeral state is empty; send a full snapshot
  on("request-sync", () => {
    sendMsg(serializer.getSnapshot());
    if (_log) _log("info", "Full DOM state sent on request-sync");
  });

  _iframe.addEventListener("load", attachToFrame);

  // If iframe already loaded, attach now
  try {
    if (_iframe.contentDocument && _iframe.contentDocument.readyState === "complete") {
      attachToFrame();
    }
  } catch (_) {}

  // Flush mutations and collect styles on interval
  flushInterval = setInterval(async () => {
    if (pendingMutations.length > 0) {
      const batch = pendingMutations;
      pendingMutations = [];
      try {
        sendMsg(serializer.syncMutations(batch));
      } catch (err) {
        // If delta encoding fails, send a full snapshot to force a clean resync
        if (_log) _log("warn", "syncMutations failed, sending full resync: " + err.message);
        try {
          if (_iframe?.contentDocument?.documentElement) {
            sendMsg(serializer.serializeFull(_iframe.contentDocument.documentElement));
          }
        } catch (_) {}
      }
    }
    try {
      if (_iframe && _iframe.contentDocument) {
        sendMsg(await serializer.collectStyles(_iframe.contentDocument));
      }
    } catch (_) {}
  }, 1000);
}

/**
 * Clean up all state when the payload is unloaded by the loader.
 */
export function destroy() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  if (_iframe) {
    _iframe.removeEventListener("load", attachToFrame);
  }
  if (serializer) {
    serializer.reset();
    serializer = null;
  }
  pendingMutations = [];
  _sendBinary = null;
  _log = null;
  _iframe = null;
}
