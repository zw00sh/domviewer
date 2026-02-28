import { useEffect, useRef, useMemo, useCallback, useState } from "react";
import morphdom from "morphdom";
import { useWebSocket } from "@/hooks/use-websocket";
import { useProxy } from "@/hooks/use-proxy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, buildViewerWsUrl } from "@/lib/utils";

interface ProxyPanelProps {
  clientId: string;
  className?: string;
  /** Called when WS status changes */
  onStatusChange?: (status: "connecting" | "open" | "closed") => void;
}

/**
 * Walk up the DOM tree from `el` to find the nearest ancestor (or itself)
 * that has a `data-nid` attribute.  Returns the nid string or null.
 */
function findNid(el: Element | null): string | null {
  let cur: Element | null = el;
  while (cur) {
    const nid = cur.getAttribute("data-nid");
    if (nid) return nid;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Interactive proxy viewer panel.
 *
 * Renders the victim's captured DOM inside a sandboxed iframe.  On the first
 * DOM update the iframe is bootstrapped via `doc.write()` and all event
 * listeners are attached once (they persist since the document is never
 * replaced).  Subsequent updates are applied incrementally using `morphdom`,
 * which preserves scroll position, focus, cursor, and CSS transitions.
 *
 * A URL bar lets the operator navigate the victim's proxy iframe to any URL.
 *
 * Input fidelity features:
 *   - Phase 1: paste/cut listener; client-side execCommand for trusted input
 *   - Phase 2: PointerEvent alongside MouseEvent (handled in client proxy.js)
 *   - Phase 3: element-level scroll detection and relay
 *   - Phase 4: wheel and contextmenu listener
 *   - Phase 5: throttled mousemove relay
 */
export function ProxyPanel({ clientId, className, onStatusChange }: ProxyPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  /** Tracks which element nid has keyboard focus for input event routing. */
  const focusedNidRef = useRef<string | null>(null);
  const lastHoverNidRef = useRef<string | null>(null);
  /** True after the first doc.write() bootstrap has completed. */
  const bootstrappedRef = useRef(false);
  /** ResizeObserver for viewport sync — disconnected on unmount. */
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [urlInput, setUrlInput] = useState<string>("");

  const wsUrl = useMemo(() => buildViewerWsUrl(clientId, "proxy"), [clientId]);

  // Pass focusedNidRef so the hook can update it when focus-sync arrives (Phase 5)
  const { version, renderHtml, proxyUrl, onMessage, lastWasSnapshot } =
    useProxy(iframeRef, focusedNidRef);
  const { send, status } = useWebSocket(wsUrl, { onMessage });

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  // Sync URL bar with live navigated messages from the proxy client
  useEffect(() => {
    if (proxyUrl !== null) setUrlInput(proxyUrl);
  }, [proxyUrl]);

  /** Send a JSON message to the server via the viewer WebSocket. */
  const sendViewerMsg = useCallback(
    (msg: object) => send(JSON.stringify(msg)),
    [send]
  );

  /**
   * Keep a ref to the latest `sendViewerMsg` so event listeners (attached
   * once during bootstrap) always use the current WebSocket send function
   * even if the WS reconnects and produces a new `send` reference.
   */
  const sendViewerMsgRef = useRef(sendViewerMsg);
  useEffect(() => {
    sendViewerMsgRef.current = sendViewerMsg;
  });

  // Disconnect ResizeObserver when the component unmounts
  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, []);

  // ─── Main rendering effect ─────────────────────────────────────────────────
  //
  // Bootstrap: on the first `version > 0`, write initial HTML via doc.write()
  //   and attach all event listeners once.  Listeners are attached to the
  //   document object — they persist across subsequent doc.write() calls because
  //   doc.open/write/close replaces content but not the document object.
  //
  // Snapshot / full navigation: when `lastWasSnapshot` is true, the entire node
  //   map was replaced (new page).  Re-write the document via doc.write() without
  //   re-attaching listeners.  morphdom would misidentify nodes because the
  //   serialiser resets its ID counter to 0 on every full capture.
  //
  // Delta patch: on incremental delta/meta updates, apply the diff via morphdom.
  //   This preserves scroll position, focus, cursor position, and CSS transitions.
  //
  useEffect(() => {
    if (version === 0) return;

    const iframe = iframeRef.current;
    if (!iframe) return;

    // ── BOOTSTRAP ──────────────────────────────────────────────────────────
    if (!bootstrappedRef.current) {
      const doc = iframe.contentDocument;
      if (!doc) return;

      doc.open();
      doc.write(renderHtml());
      doc.close();
      bootstrappedRef.current = true;

      // Re-acquire reference — some browsers issue a fresh reference after write
      const iframeDoc = iframe.contentDocument!;

      const FOCUSABLE_SELECTOR =
        "input, textarea, select, button, [contenteditable], [tabindex]";

      // ── Mouse events ───────────────────────────────────────────────────
      function onMouseEvent(e: MouseEvent) {
        // Prevent the browser from following links or submitting forms
        e.preventDefault();

        const target = e.target as Element | null;
        const nid = findNid(target);
        if (!nid) return;

        if (e.type === "click") {
          // Track focused element so keystrokes are routed to the right nid.
          // Explicit .focus() is needed because e.preventDefault() on mousedown
          // suppresses the browser's auto-focus behaviour.
          const focusableEl = target?.closest(FOCUSABLE_SELECTOR);
          if (focusableEl) {
            const focusableNid = findNid(focusableEl) ?? nid;
            (focusableEl as HTMLElement).focus?.();
            focusedNidRef.current = focusableNid;
            sendViewerMsgRef.current({
              type: "event",
              data: { nid: focusableNid, event: "focus" },
            });
          } else if (focusedNidRef.current) {
            const prevNid = focusedNidRef.current;
            focusedNidRef.current = null;
            sendViewerMsgRef.current({
              type: "event",
              data: { nid: prevNid, event: "blur" },
            });
          }
        }

        sendViewerMsgRef.current({
          type: "event",
          data: {
            nid,
            event: e.type,
            button: e.button,
            buttons: e.buttons,
            // Coordinate passthrough so victim-side handlers receive real positions
            clientX: e.clientX,
            clientY: e.clientY,
            offsetX: e.offsetX,
            offsetY: e.offsetY,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
          },
        });
      }

      // ── Keyboard events ──────────────────────────────────────────────────
      function onKeyEvent(e: KeyboardEvent) {
        const target = (e.target as Element | null) ?? iframeDoc.activeElement;
        const nid = findNid(target);
        if (!nid) return;

        sendViewerMsgRef.current({
          type: "event",
          data: {
            nid,
            event: e.type,
            key: e.key,
            code: e.code,
            keyCode: e.keyCode,
            charCode: e.charCode,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
          },
        });

        // Synthesise input events from keydown when a focusable element is active.
        // Use focusedNidRef — the receiver of typed input, not the keyboard target.
        const focusedNid = focusedNidRef.current;
        if (e.type === "keydown" && focusedNid) {
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            sendViewerMsgRef.current({
              type: "event",
              data: { nid: focusedNid, event: "input", data: e.key, inputType: "insertText" },
            });
          } else if (e.key === "Backspace") {
            sendViewerMsgRef.current({
              type: "event",
              data: { nid: focusedNid, event: "input", inputType: "deleteContentBackward" },
            });
          } else if (e.key === "Delete") {
            sendViewerMsgRef.current({
              type: "event",
              data: { nid: focusedNid, event: "input", inputType: "deleteContentForward" },
            });
          } else if (e.key === "Enter" && (target as Element | null)?.tagName === "INPUT") {
            sendViewerMsgRef.current({
              type: "event",
              data: { nid: focusedNid, event: "change" },
            });
          }
        }
      }

      // ── Hover events (with dedup) ──────────────────────────────────────
      function onHoverEvent(e: MouseEvent) {
        const target = e.target as Element | null;
        const nid = findNid(target);

        if (e.type === "mouseover") {
          if (nid === lastHoverNidRef.current) return;
          lastHoverNidRef.current = nid;
          if (!nid) return;
          sendViewerMsgRef.current({ type: "event", data: { nid, event: "mouseover" } });
        } else if (e.type === "mouseout") {
          const relatedNid = findNid(e.relatedTarget as Element | null);
          if (relatedNid === lastHoverNidRef.current) return;
          lastHoverNidRef.current = relatedNid;
          if (!nid) return;
          sendViewerMsgRef.current({ type: "event", data: { nid, event: "mouseout" } });
        }
      }

      // ── Phase 5: throttled mousemove (50ms) ───────────────────────────
      // Provides cursor position to the victim for hover-driven UI elements.
      // Throttled to avoid flooding the WebSocket with move events.
      let mouseMoveThrottle: ReturnType<typeof setTimeout> | null = null;
      function onMouseMoveEvent(e: MouseEvent) {
        if (mouseMoveThrottle) return;
        const target = e.target as Element | null;
        const nid = findNid(target);
        if (!nid) return;
        mouseMoveThrottle = setTimeout(() => {
          mouseMoveThrottle = null;
          sendViewerMsgRef.current({
            type: "event",
            data: {
              nid,
              event: "mousemove",
              clientX: e.clientX,
              clientY: e.clientY,
              buttons: e.buttons,
            },
          });
        }, 50);
      }

      // ── Phase 4: wheel events ─────────────────────────────────────────
      function onWheelEvent(e: WheelEvent) {
        const target = e.target as Element | null;
        const nid = findNid(target);
        if (!nid) return;
        sendViewerMsgRef.current({
          type: "event",
          data: {
            nid,
            event: "wheel",
            deltaX: e.deltaX,
            deltaY: e.deltaY,
            deltaMode: e.deltaMode,
            clientX: e.clientX,
            clientY: e.clientY,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
          },
        });
      }

      // ── Phase 4: contextmenu ─────────────────────────────────────────
      function onContextMenuEvent(e: MouseEvent) {
        e.preventDefault();
        const target = e.target as Element | null;
        const nid = findNid(target);
        if (!nid) return;
        sendViewerMsgRef.current({
          type: "event",
          data: {
            nid,
            event: "contextmenu",
            button: e.button,
            buttons: e.buttons,
            clientX: e.clientX,
            clientY: e.clientY,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
          },
        });
      }

      // ── Native form change events (select, checkbox, radio) ────────────
      // These fire from native browser UI even in a sandboxed iframe, so we
      // capture them to relay accurate form state to the victim's page.
      function onChangeEvent(e: Event) {
        const target = e.target as HTMLElement | null;
        const nid = findNid(target);
        if (!nid) return;

        const tagName = target?.tagName;
        if (tagName === "SELECT") {
          const sel = target as HTMLSelectElement;
          sendViewerMsgRef.current({
            type: "event",
            data: { nid, event: "change", selectedIndex: sel.selectedIndex, value: sel.value },
          });
        } else if (tagName === "INPUT") {
          const inp = target as HTMLInputElement;
          if (inp.type === "checkbox" || inp.type === "radio") {
            sendViewerMsgRef.current({
              type: "event",
              data: { nid, event: "change", checked: inp.checked },
            });
          }
        }
      }

      // ── Phase 1: paste/cut ─────────────────────────────────────────────
      // Intercept clipboard events in the viewer and relay as input events.
      // The client uses execCommand("insertText") to fire a trusted InputEvent.
      function onPasteEvent(e: ClipboardEvent) {
        e.preventDefault();
        const focusedNid = focusedNidRef.current;
        if (!focusedNid) return;
        const text = e.clipboardData?.getData("text/plain") ?? "";
        if (!text) return;
        sendViewerMsgRef.current({
          type: "event",
          data: { nid: focusedNid, event: "input", inputType: "insertFromPaste", data: text },
        });
      }

      function onCutEvent(e: ClipboardEvent) {
        e.preventDefault();
        const focusedNid = focusedNidRef.current;
        if (!focusedNid) return;

        // Read selected text from the currently focused viewer element
        const focusedEl = iframeDoc.querySelector(
          `[data-nid="${CSS.escape(focusedNid)}"]`
        ) as HTMLInputElement | null;
        if (focusedEl && "selectionStart" in focusedEl) {
          const sel = focusedEl.value.slice(
            focusedEl.selectionStart ?? 0,
            focusedEl.selectionEnd ?? 0
          );
          if (sel) {
            // Place selected text on the system clipboard
            e.clipboardData?.setData("text/plain", sel);
          }
        }
        sendViewerMsgRef.current({
          type: "event",
          data: { nid: focusedNid, event: "input", inputType: "deleteByCut" },
        });
      }

      // ── Viewer scroll → victim scroll (throttled, 100ms) ──────────────
      // Phase 3: distinguish window-level vs element-level scroll.
      let scrollThrottle: ReturnType<typeof setTimeout> | null = null;
      function onScrollEvent(e: Event) {
        const target = e.target as Node | null;

        // Element-level scroll (Phase 3): a specific scrollable container scrolled.
        // `target === iframeDoc` covers the Document node; `target === documentElement`
        // covers the <html> element — both signal a window-level scroll.
        const isWindowScroll =
          !target ||
          target === (iframeDoc as unknown as Node) ||
          target === iframeDoc.documentElement;

        if (!isWindowScroll) {
          const nid = findNid(target as Element | null);
          if (!nid) return;
          // Throttle per-element reuses the same timer for simplicity
          if (scrollThrottle) return;
          scrollThrottle = setTimeout(() => {
            scrollThrottle = null;
            const el = target as HTMLElement;
            sendViewerMsgRef.current({
              type: "event",
              data: {
                nid,
                event: "element-scroll",
                scrollTop: el.scrollTop,
                scrollLeft: el.scrollLeft,
              },
            });
          }, 100);
          return;
        }

        // Window-level scroll: relay via existing scroll message
        if (scrollThrottle) return;
        scrollThrottle = setTimeout(() => {
          scrollThrottle = null;
          const win = iframe!.contentWindow;
          if (!win) return;
          sendViewerMsgRef.current({
            type: "event",
            data: { event: "scroll", scrollX: win.scrollX, scrollY: win.scrollY },
          });
        }, 100);
      }

      iframeDoc.addEventListener("click", onMouseEvent);
      iframeDoc.addEventListener("dblclick", onMouseEvent);
      iframeDoc.addEventListener("mousedown", onMouseEvent);
      iframeDoc.addEventListener("mouseup", onMouseEvent);
      iframeDoc.addEventListener("mouseover", onHoverEvent);
      iframeDoc.addEventListener("mouseout", onHoverEvent);
      iframeDoc.addEventListener("mousemove", onMouseMoveEvent);
      iframeDoc.addEventListener("keydown", onKeyEvent);
      iframeDoc.addEventListener("keyup", onKeyEvent);
      iframeDoc.addEventListener("change", onChangeEvent);
      iframeDoc.addEventListener("paste", onPasteEvent);
      iframeDoc.addEventListener("cut", onCutEvent);
      iframeDoc.addEventListener("scroll", onScrollEvent, { capture: true, passive: true });
      iframeDoc.addEventListener("wheel", onWheelEvent, { capture: true, passive: true });
      iframeDoc.addEventListener("contextmenu", onContextMenuEvent);

      // ── Viewport size sync: keep victim iframe dimensions in sync ──────
      const ro = new ResizeObserver(() => {
        const rect = iframe.getBoundingClientRect();
        sendViewerMsgRef.current({
          type: "viewport",
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      });
      ro.observe(iframe);
      resizeObserverRef.current = ro;

      // Listeners are attached to the persisted document — no per-run cleanup
      return;
    }

    // ── SNAPSHOT (full navigation) ─────────────────────────────────────────
    //
    // A snapshot replaces the entire node map (new page after navigation).
    // The serialiser resets its ID counter to 0 on each full capture, so the
    // new page's nodes have the same IDs (n0, n1, n2 …) as the previous page.
    //
    // We use morphdom WITHOUT a getNodeKey function so it falls back to matching
    // by `id` attribute / position (<html>→<html>, <head>→<head>, <body>→<body>).
    // This avoids recycled data-nid collisions across navigations while
    // preserving event listeners on the document (no doc.write() needed — which
    // strips listeners in Chromium despite doc.open() reusing the same object).
    if (lastWasSnapshot) {
      const iframeDoc = iframe.contentDocument;
      if (!iframeDoc?.documentElement) return;

      const newHtml = renderHtml();
      const newDoc = new DOMParser().parseFromString(newHtml, "text/html");

      morphdom(iframeDoc.documentElement, newDoc.documentElement, {
        onBeforeElUpdated: (from: HTMLElement) => {
          if (from !== iframeDoc.activeElement) return true;
          const tag = from.tagName;
          return (
            tag !== "INPUT" &&
            tag !== "TEXTAREA" &&
            tag !== "SELECT" &&
            !from.isContentEditable
          );
        },
      });
      return;
    }

    // ── PATCH (morphdom) ───────────────────────────────────────────────────
    const iframeDoc = iframe.contentDocument;
    if (!iframeDoc?.documentElement) return;

    const newHtml = renderHtml();
    const newDoc = new DOMParser().parseFromString(newHtml, "text/html");

    morphdom(iframeDoc.documentElement, newDoc.documentElement, {
      /**
       * Use `data-nid` as the morphdom key so elements are matched by their
       * stable node ID rather than by position.  This ensures morphdom patches
       * existing nodes in-place (preserving focus, scroll, transitions) instead
       * of discarding and recreating them.
       */
      getNodeKey: (node: Node) =>
        (node as Element).getAttribute?.("data-nid") ?? undefined,

      /**
       * Skip updating the element that currently has focus to preserve cursor
       * position, text selection, and input state mid-edit.
       *
       * Only skip truly interactive form elements.  In sandboxed iframes with
       * no scripts, document.activeElement defaults to <body> when nothing is
       * explicitly focused — naively comparing `from !== activeElement` would
       * skip <body> on every delta, freezing the page body while still patching
       * <head> (which is why CSS updated but body content did not).
       */
      onBeforeElUpdated: (from: HTMLElement) => {
        if (from !== iframeDoc.activeElement) return true;
        const tag = from.tagName;
        return (
          tag !== "INPUT" &&
          tag !== "TEXTAREA" &&
          tag !== "SELECT" &&
          !from.isContentEditable
        );
      },
    });
  }, [version, renderHtml, lastWasSnapshot]);

  // ─── URL bar navigation ───────────────────────────────────────────────────

  function handleNavigate() {
    const url = urlInput.trim();
    if (!url) return;
    sendViewerMsg({ type: "navigate", url });
  }

  function handleUrlKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleNavigate();
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {/* ── URL bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-1.5 bg-card border-b border-border">
        <Input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={handleUrlKeyDown}
          placeholder="Navigate to URL…"
          className="font-mono text-xs h-8"
        />
        <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={handleNavigate}>
          Go
        </Button>
      </div>

      {/* ── Viewport ─────────────────────────────────────────────────── */}
      {/* Events are captured directly on iframe.contentDocument (no overlay) */}
      <div className="flex-1 min-h-0 w-full overflow-hidden bg-white">
        <iframe
          ref={iframeRef}
          sandbox="allow-same-origin"
          className="w-full h-full border-none block"
          title="Proxy viewer"
        />
      </div>
    </div>
  );
}
