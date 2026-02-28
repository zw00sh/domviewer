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
 * Build the WebSocket URL for the global log viewer (no specific client).
 */
export function buildLogViewerWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/view?payload=logs`;
}
