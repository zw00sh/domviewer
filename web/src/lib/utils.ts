import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Build the WebSocket URL for a viewer connection to the management server.
 * Uses wss: when the page is served over HTTPS, ws: otherwise.
 *
 * @param clientId - The client UUID.
 * @param payload - The payload name (e.g. "domviewer", "spider", "proxy", "keylogger", "logs").
 * @returns Full WebSocket URL string.
 */
export function buildViewerWsUrl(clientId: string, payload: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/view?id=${clientId}&payload=${payload}`;
}

/**
 * Build the WebSocket URL for the dashboard subscription.
 * Receives live link/client change events from the management server.
 */
export function buildDashboardWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/view?payload=dashboard`;
}

/**
 * Build the WebSocket URL for the global log viewer (no specific client).
 */
export function buildLogViewerWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/view?payload=logs`;
}

/**
 * Format a Unix timestamp in milliseconds as a human-readable time string.
 */
export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Trigger a browser download of the given data as a JSON file.
 * @param data - Any JSON-serialisable value.
 * @param filename - Suggested filename (should end in .json).
 */
export function exportJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
