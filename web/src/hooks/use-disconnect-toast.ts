import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * Fires a "Client disconnected from C2" toast whenever `clientConnected` transitions to false.
 * Replaces 4+ identical useEffect blocks across DomViewerPanel, ProxyPanel, SpiderPanel,
 * KeyloggerPanel, and CookiesPanel.
 *
 * The first value of `clientConnected` (the authoritative initial state received from the server
 * via the `client-info` WS message) is never toasted — only subsequent live transitions to false
 * trigger the toast. This prevents a spurious "disconnected" toast when navigating to a page for
 * a client that was already offline before the viewer opened.
 */
export function useDisconnectToast(clientConnected: boolean): void {
  const hasReceivedInitial = useRef(false);
  useEffect(() => {
    if (!hasReceivedInitial.current) {
      hasReceivedInitial.current = true;
      return;
    }
    if (!clientConnected) {
      toast("Client disconnected from C2");
    }
  }, [clientConnected]);
}
