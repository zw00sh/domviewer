import { useEffect, useRef, useMemo } from "react";
import { useWebSocket } from "@/hooks/use-websocket";
import { useDomViewer } from "@/hooks/use-dom-viewer";
import { cn, buildViewerWsUrl } from "@/lib/utils";

interface DomViewerPanelProps {
  clientId: string;
  /** Applied to the iframe element. Defaults to a sensible min-height. */
  className?: string;
  /** Called when WS status changes */
  onStatusChange?: (status: "connecting" | "open" | "closed") => void;
  /** Called whenever the captured page's baseUrl changes (e.g. on navigation) */
  onUrlChange?: (url: string | null) => void;
}

/**
 * Renders the live DOM captured from a client by applying incoming
 * JSON deltas/snapshots to a local node map and writing the rendered
 * HTML into a sandboxed iframe.
 */
export function DomViewerPanel({
  clientId,
  className,
  onStatusChange,
  onUrlChange,
}: DomViewerPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const wsUrl = useMemo(() => buildViewerWsUrl(clientId, "domviewer"), [clientId]);

  const { html, baseUrl, onMessage } = useDomViewer();
  const { status } = useWebSocket(wsUrl, { onMessage });

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  useEffect(() => {
    onUrlChange?.(baseUrl);
  }, [baseUrl, onUrlChange]);

  useEffect(() => {
    if (!html || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
  }, [html]);

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-same-origin"
      className={cn(
        "w-full border border-border rounded-md bg-white",
        className
      )}
      style={className ? undefined : { height: "calc(100vh - 180px)", minHeight: "400px" }}
    />
  );
}
