import { useEffect, useRef, useMemo } from "react";
import { Loader2, WifiOff } from "lucide-react";
import { useWebSocket } from "@/hooks/use-websocket";
import { useDomViewer } from "@/hooks/use-dom-viewer";
import { useDisconnectToast } from "@/hooks/use-disconnect-toast";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PayloadStatusBanner } from "@/components/client/PayloadStatusBanner";
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

  const { html, baseUrl, hasData, clientConnected, payloadEnabled, onMessage } = useDomViewer();
  const { status } = useWebSocket(wsUrl, { onMessage });

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  useEffect(() => {
    onUrlChange?.(baseUrl);
  }, [baseUrl, onUrlChange]);

  useDisconnectToast(clientConnected);

  useEffect(() => {
    if (!html || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
  }, [html]);

  // The client is considered offline if we received a "disconnected" WS message or
  // the client-info message indicated it was already offline. We only show the offline
  // card when no DOM has been received yet (hasData=false), so existing captured DOM
  // stays visible after a disconnect.
  const showDisabledCard = !payloadEnabled && !hasData;
  const showOfflineCard = !clientConnected && !hasData && payloadEnabled;
  const showSpinner = !hasData && !showOfflineCard && !showDisabledCard && status === "open";

  if (showDisabledCard || showOfflineCard) {
    return (
      <div
        className={cn(
          "flex items-center justify-center p-8",
          className
        )}
        style={className ? undefined : { height: "calc(100vh - 180px)", minHeight: "400px" }}
      >
        {showDisabledCard ? (
          <div className="w-full max-w-md">
            <PayloadStatusBanner
              clientId={clientId}
              payloadKey="domviewer"
              clientConnected={clientConnected}
              payloadEnabled={payloadEnabled}
            />
          </div>
        ) : (
          <Card className="w-80 text-center">
            <CardHeader className="items-center gap-2">
              <WifiOff className="h-8 w-8 text-muted-foreground" />
              <CardTitle>Client offline</CardTitle>
              <CardDescription>
                This client is not connected. The DOM will appear here when the client reconnects.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
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
