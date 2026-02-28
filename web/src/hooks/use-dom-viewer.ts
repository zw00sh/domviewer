import { useRef, useState, useCallback } from "react";
import {
  type NodeData,
  type Meta,
  type DomViewerMessage,
  applyMessage,
  renderToHtml,
} from "@/lib/dom-viewer-core";

interface UseDomViewerResult {
  html: string;
  /** The baseUrl from the captured page's meta (updated on each snapshot/meta message). */
  baseUrl: string | null;
  /**
   * Pass this to `useWebSocket`'s `onMessage` option so every incoming message
   * is processed synchronously — no messages are dropped due to React batching.
   */
  onMessage: (event: MessageEvent) => void;
}

/**
 * React hook that manages the domviewer node map and renders HTML from
 * incoming WebSocket messages (JSON-encoded snapshots/deltas/meta updates).
 *
 * Returns an `onMessage` callback to wire into `useWebSocket({ onMessage })`
 * so that every message is applied in arrival order without batching drops.
 *
 * @returns `{ html, baseUrl, onMessage }` — pass `onMessage` to `useWebSocket`.
 */
export function useDomViewer(): UseDomViewerResult {
  const nodesRef = useRef<Map<string, NodeData>>(new Map());
  const metaRef = useRef<Meta>({});
  const [html, setHtml] = useState<string>(
    "<!DOCTYPE html><html><body><p>No DOM captured yet.</p></body></html>"
  );
  const [baseUrl, setBaseUrl] = useState<string | null>(null);

  const onMessage = useCallback((event: MessageEvent) => {
    let msg: DomViewerMessage;
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }

    if (!msg.type) return;

    applyMessage(nodesRef.current, metaRef.current, msg);
    setHtml(renderToHtml(nodesRef.current, metaRef.current.rootId, metaRef.current));

    // Update baseUrl whenever a snapshot or meta message carries it
    if ((msg.type === "snapshot" || msg.type === "meta") && msg.meta?.baseUrl != null) {
      setBaseUrl(msg.meta.baseUrl ?? null);
    }
  }, []);

  return { html, baseUrl, onMessage };
}
