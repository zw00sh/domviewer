import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { buildDashboardWsUrl } from "@/lib/utils";
import type { Link, Client } from "@/types/api";

interface UseDashboardResult {
  links: Link[];
  clients: Client[];
  loading: boolean;
  /** REST fallback — re-fetches links and clients from the API. */
  refetch: () => void;
}

/**
 * Subscribes to the dashboard WebSocket for real-time link and client updates.
 * Replaces polling in Dashboard.tsx — changes are pushed instantly on connect/disconnect
 * and after REST mutations (create/patch/delete).
 *
 * `refetch()` is kept as a REST fallback for immediate post-mutation confirmation
 * (e.g. CreateLinkForm onCreated) and as a safety net if the WS drops.
 */
export function useDashboard(): UseDashboardResult {
  const [links, setLinks] = useState<Link[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const [linksRes, clientsRes] = await Promise.all([
        fetch("/api/links"),
        fetch("/api/clients"),
      ]);
      if (linksRes.ok) setLinks(await linksRes.json());
      if (clientsRes.ok) setClients(await clientsRes.json());
    } catch {
      // Best-effort — WS is the primary source
    }
  }, []);

  useEffect(() => {
    const url = buildDashboardWsUrl();
    const ws = new WebSocket(url);

    ws.addEventListener("message", (e) => {
      let msg: {
        type: string;
        links?: Link[];
        clients?: Client[];
        link?: Link;
        linkId?: string;
        client?: Client;
        clientId?: string;
      };
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "init":
          setLinks(msg.links ?? []);
          setClients(msg.clients ?? []);
          setLoading(false);
          break;

        case "link-created":
          if (msg.link) setLinks((prev) => [...prev, msg.link!]);
          break;

        case "link-updated":
          if (msg.link)
            setLinks((prev) =>
              prev.map((l) => (l.id === msg.link!.id ? msg.link! : l))
            );
          break;

        case "link-deleted":
          if (msg.linkId)
            setLinks((prev) => prev.filter((l) => l.id !== msg.linkId));
          break;

        case "client-connected": {
          if (!msg.client) break;
          const c = msg.client;
          const label = `${c.id.slice(0, 8)}… ${c.origin ? `from ${c.origin}` : ""}`.trim();
          setClients((prev) => {
            const exists = prev.some((x) => x.id === c.id);
            if (exists) {
              // Reconnect — was previously disconnected
              const wasConnected = prev.find((x) => x.id === c.id)?.connected;
              if (!wasConnected) toast("Client reconnected", { description: label });
              return prev.map((x) => (x.id === c.id ? c : x));
            }
            toast("Client connected", { description: label });
            return [...prev, c];
          });
          break;
        }

        case "client-disconnected":
          if (msg.client)
            setClients((prev) =>
              prev.map((x) => (x.id === msg.client!.id ? msg.client! : x))
            );
          if (msg.client) {
            const c = msg.client;
            const label = `${c.id.slice(0, 8)}… ${c.origin ? `from ${c.origin}` : ""}`.trim();
            toast("Client disconnected", { description: label });
          }
          break;

        case "client-updated":
          if (msg.client)
            setClients((prev) =>
              prev.map((x) => (x.id === msg.client!.id ? msg.client! : x))
            );
          break;

        case "client-deleted":
          if (msg.clientId)
            setClients((prev) => prev.filter((x) => x.id !== msg.clientId));
          break;
      }
    });

    ws.addEventListener("close", () => {
      // WS dropped — fall back to REST to stay in sync
      refetch();
    });

    return () => ws.close();
  }, [refetch]);

  return { links, clients, loading, refetch };
}
