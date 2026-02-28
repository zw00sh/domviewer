import { useRef, useState, useCallback } from "react";
import type { RefObject, MutableRefObject } from "react";
import {
  type NodeData,
  type Meta,
  type SnapshotMessage,
  type DeltaMessage,
  type MetaMessage,
  applyMessage,
  renderToHtml,
} from "@/lib/dom-viewer-core";

// ─── Proxy-specific message types ─────────────────────────────────────────────

interface ProxySnapshotMessage extends SnapshotMessage {
  proxyUrl?: string;
}

interface NavigatedMessage {
  type: "navigated";
  url: string;
}

interface DisconnectedMessage {
  type: "disconnected";
}

interface ValueSyncMessage {
  type: "value-sync";
  nid: string;
  value: string;
}

/** Sent by the client after a checkbox/radio changes state. */
interface CheckedSyncMessage {
  type: "checked-sync";
  nid: string;
  checked: boolean;
}

/** Sent by the client after a <select> changes selection. */
interface SelectSyncMessage {
  type: "select-sync";
  nid: string;
  selectedIndex: number;
  value: string;
}

/** Sent by the client to sync victim page window scroll position to viewer. */
interface ScrollSyncMessage {
  type: "scroll-sync";
  scrollX: number;
  scrollY: number;
}

/** Phase 3: Sent by the client to sync a scrollable element's position. */
interface ElementScrollSyncMessage {
  type: "element-scroll-sync";
  nid: string;
  scrollTop: number;
  scrollLeft: number;
}

/** Phase 1: Sent by the client to sync text cursor / selection range. */
interface SelectionSyncMessage {
  type: "selection-sync";
  nid: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Phase 5: Sent by the client to sync Tab-driven focus changes. */
interface FocusSyncMessage {
  type: "focus-sync";
  nid: string;
}

type ProxyMessage =
  | ProxySnapshotMessage
  | DeltaMessage
  | MetaMessage
  | NavigatedMessage
  | DisconnectedMessage
  | ValueSyncMessage
  | CheckedSyncMessage
  | SelectSyncMessage
  | ScrollSyncMessage
  | ElementScrollSyncMessage
  | SelectionSyncMessage
  | FocusSyncMessage;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseProxyResult {
  /**
   * Incremented on every DOM update (snapshot, delta, meta, value-sync).
   * The panel uses this to trigger morphdom patching without storing an HTML
   * string in React state.
   */
  version: number;
  /**
   * Render the current node map to an HTML string on demand.
   * Call once for the bootstrap write and on each version change for morphdom.
   */
  renderHtml: () => string;
  /** Current URL shown in the proxy viewer's URL bar. */
  proxyUrl: string | null;
  /**
   * True when the last DOM update was a full snapshot (full-page replacement,
   * e.g. after navigation).  The panel uses this to re-write the iframe via
   * doc.write() instead of applying a morphdom incremental patch, which avoids
   * node-ID collisions caused by the serializer resetting nextId to 0 on each
   * full capture.
   */
  lastWasSnapshot: boolean;
  /**
   * Pass this to `useWebSocket`'s `onMessage` option so every incoming message
   * is applied synchronously without React batching drops.
   */
  onMessage: (event: MessageEvent) => void;
}

/**
 * React hook that manages the proxy DOM node map and exposes a `version`
 * counter incremented on every DOM update, plus a `renderHtml()` function to
 * produce the current HTML string on demand for morphdom patching.
 *
 * Accepts an optional `iframeRef` to apply live DOM patches for checked-sync,
 * select-sync, scroll-sync, element-scroll-sync, selection-sync, and
 * focus-sync messages without triggering a full re-render.
 *
 * @param iframeRef - Ref to the viewer `<iframe>` element.
 * @param focusedNidRef - Ref to the currently focused element's nid (updated by focus-sync).
 * @returns `{ version, renderHtml, proxyUrl, onMessage, lastWasSnapshot }`
 */
export function useProxy(
  iframeRef?: RefObject<HTMLIFrameElement | null>,
  focusedNidRef?: RefObject<string | null>
): UseProxyResult {
  const nodesRef = useRef<Map<string, NodeData>>(new Map());
  const metaRef = useRef<Meta>({});
  const [version, setVersion] = useState<number>(0);
  const [proxyUrl, setProxyUrl] = useState<string | null>(null);
  /**
   * Tracks whether the last DOM update was a full snapshot.  Set synchronously
   * before each `setVersion` call so the value is stable for the render cycle
   * that follows.
   */
  const lastWasSnapshotRef = useRef(false);

  /** Render current node map to an HTML string with data-nid attrs embedded. */
  const renderHtml = useCallback((): string => {
    return renderToHtml(nodesRef.current, metaRef.current.rootId, metaRef.current, {
      embedNodeIds: true,
    });
  }, []);

  const onMessage = useCallback(
    (event: MessageEvent) => {
      let msg: ProxyMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }

      if (!msg.type) return;

      switch (msg.type) {
        case "snapshot":
        case "delta":
        case "meta":
          applyMessage(nodesRef.current, metaRef.current, msg);
          // Record snapshot flag before triggering re-render so the effect
          // that fires after the render sees the correct value.
          lastWasSnapshotRef.current = msg.type === "snapshot";
          setVersion((v) => v + 1);
          if (msg.type === "snapshot") {
            if ((msg as ProxySnapshotMessage).proxyUrl) {
              setProxyUrl((msg as ProxySnapshotMessage).proxyUrl!);
            }
          }
          break;

        case "value-sync": {
          // Update the node's value attr so renderHtml emits the current value
          // (.value is a DOM property never reflected in snapshot/delta attrs)
          const node = nodesRef.current.get(msg.nid);
          if (node && node.type === 1) {
            if (!node.attrs) node.attrs = {};
            node.attrs.value = msg.value;
            setVersion((v) => v + 1);
          }
          break;
        }

        case "checked-sync": {
          // Keep virtual node attrs consistent for the next morphdom cycle
          const node = nodesRef.current.get(msg.nid);
          if (node && node.type === 1) {
            if (!node.attrs) node.attrs = {};
            if (msg.checked) {
              node.attrs.checked = "";
            } else {
              delete node.attrs.checked;
            }
          }
          // Apply directly to the live DOM for instant visual feedback
          const checkedDoc = iframeRef?.current?.contentDocument;
          if (checkedDoc) {
            const el = checkedDoc.querySelector(
              `[data-nid="${CSS.escape(msg.nid)}"]`
            ) as HTMLInputElement | null;
            if (el) el.checked = msg.checked;
          }
          break;
        }

        case "select-sync": {
          // Keep virtual node attrs consistent
          const node = nodesRef.current.get(msg.nid);
          if (node && node.type === 1) {
            if (!node.attrs) node.attrs = {};
            node.attrs.value = msg.value;
          }
          // Apply directly to the live DOM for instant visual feedback
          const selectDoc = iframeRef?.current?.contentDocument;
          if (selectDoc) {
            const el = selectDoc.querySelector(
              `[data-nid="${CSS.escape(msg.nid)}"]`
            ) as HTMLSelectElement | null;
            if (el) el.selectedIndex = msg.selectedIndex;
          }
          break;
        }

        case "scroll-sync": {
          // Scroll the viewer iframe to match the victim page window scroll position
          iframeRef?.current?.contentWindow?.scrollTo(
            msg.scrollX ?? 0,
            msg.scrollY ?? 0
          );
          break;
        }

        case "element-scroll-sync": {
          // Phase 3: scroll a specific element in the viewer iframe to match the victim
          const scrollDoc = iframeRef?.current?.contentDocument;
          if (scrollDoc) {
            const el = scrollDoc.querySelector(
              `[data-nid="${CSS.escape(msg.nid)}"]`
            ) as HTMLElement | null;
            if (el) {
              el.scrollTop = msg.scrollTop ?? 0;
              el.scrollLeft = msg.scrollLeft ?? 0;
            }
          }
          break;
        }

        case "selection-sync": {
          // Phase 1: update the cursor / selection in the viewer iframe element
          const selDoc = iframeRef?.current?.contentDocument;
          if (selDoc) {
            const el = selDoc.querySelector(
              `[data-nid="${CSS.escape(msg.nid)}"]`
            ) as HTMLInputElement | null;
            try {
              el?.setSelectionRange?.(msg.selectionStart, msg.selectionEnd);
            } catch (_) {}
          }
          break;
        }

        case "focus-sync": {
          // Phase 5: update focusedNidRef and focus the element in the viewer iframe
          if (focusedNidRef) {
            (focusedNidRef as MutableRefObject<string | null>).current = msg.nid;
          }
          const focusDoc = iframeRef?.current?.contentDocument;
          if (focusDoc) {
            const el = focusDoc.querySelector(
              `[data-nid="${CSS.escape(msg.nid)}"]`
            ) as HTMLElement | null;
            el?.focus?.();
          }
          break;
        }

        case "navigated":
          setProxyUrl(msg.url);
          break;

        case "disconnected":
          // No state change needed — the panel can observe WS status instead
          break;
      }
    },
    [iframeRef]
  );

  return { version, renderHtml, proxyUrl, onMessage, lastWasSnapshot: lastWasSnapshotRef.current };
}
