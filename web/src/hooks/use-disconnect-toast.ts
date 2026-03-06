import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Fires a "Client disconnected from C2" toast whenever `clientConnected` transitions to false.
 * Replaces 4+ identical useEffect blocks across DomViewerPanel, ProxyPanel, SpiderPanel,
 * KeyloggerPanel, and CookiesPanel.
 */
export function useDisconnectToast(clientConnected: boolean): void {
  useEffect(() => {
    if (!clientConnected) {
      toast("Client disconnected from C2");
    }
  }, [clientConnected]);
}
