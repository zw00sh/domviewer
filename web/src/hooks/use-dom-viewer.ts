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
  /** True once the first DOM message (snapshot/delta/meta) has been received. */
  hasData: boolean;
  /** False when the client has disconnected from C2 (reset to true on next DOM message). */
  clientConnected: boolean;
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
 * @returns `{ html, baseUrl, hasData, clientConnected, onMessage }`
 */
export function useDomViewer(): UseDomViewerResult {
  const nodesRef = useRef<Map<string, NodeData>>(new Map());
  const metaRef = useRef<Meta>({});
  const [html, setHtml] = useState<string>(
    "<!DOCTYPE html><html><body></body></html>"
  );
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [hasData, setHasData] = useState(false);
  const [clientConnected, setClientConnected] = useState(true);

  const onMessage = useCallback((event: MessageEvent) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let msg: any;
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }

    if (!msg.type) return;

    if (msg.type === "disconnected") {
      setClientConnected(false);
      return;
    }

    const dvMsg = msg as DomViewerMessage;
    applyMessage(nodesRef.current, metaRef.current, dvMsg);
    setHtml(renderToHtml(nodesRef.current, metaRef.current.rootId, metaRef.current));
    // Only count as "has data" once a real DOM rootId exists — an offline client's
    // initial empty snapshot has no rootId and should not count as real content.
    if (metaRef.current.rootId) setHasData(true);
    setClientConnected(true);

    // Update baseUrl whenever a snapshot or meta message carries it
    if ((dvMsg.type === "snapshot" || dvMsg.type === "meta") && dvMsg.meta?.baseUrl != null) {
      setBaseUrl(dvMsg.meta.baseUrl ?? null);
    }
  }, []);

  return { html, baseUrl, hasData, clientConnected, onMessage };
}
