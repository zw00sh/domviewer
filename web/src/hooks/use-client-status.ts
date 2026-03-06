import { useEffect, useState, useCallback } from "react";
import { buildDashboardWsUrl } from "@/lib/utils";
import type { Client } from "@/types/api";

interface UseClientStatusResult {
  client: Client | null;
  refetch: () => void;
}

/**
 * Fetches a single client's data and keeps it up-to-date via the dashboard WebSocket.
 * Replaces the `usePolling` call in TopBar — status dot and tool nav update in real-time
 * without waiting for a polling interval.
 *
 * `refetch()` is kept for post-mutation refreshes (e.g. after EditClientDialog closes).
 */
export function useClientStatus(clientId: string | undefined): UseClientStatusResult {
  const [client, setClient] = useState<Client | null>(null);

  const refetch = useCallback(async () => {
    if (!clientId) return;
    try {
      const res = await fetch(`/api/clients/${clientId}`);
      if (res.ok) setClient(await res.json());
    } catch {
      // Best-effort
    }
  }, [clientId]);

  // Initial REST fetch
  useEffect(() => {
    refetch();
  }, [refetch]);

  // Dashboard WS for real-time updates
  useEffect(() => {
    if (!clientId) return;

    const url = buildDashboardWsUrl();
    const ws = new WebSocket(url);

    ws.addEventListener("message", (e) => {
      let msg: { type: string; client?: Client; clientId?: string };
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "client-connected":
        case "client-disconnected":
        case "client-updated":
          if (msg.client?.id === clientId) setClient(msg.client);
          break;
        case "client-deleted":
          if (msg.clientId === clientId) setClient(null);
          break;
      }
    });

    ws.addEventListener("close", () => {
      // WS dropped — fall back to REST
      refetch();
    });

    return () => ws.close();
  }, [clientId, refetch]);

  return { client, refetch };
}
