/**
 * Shared WebSocket utilities used by both the C2 and management servers.
 */

/**
 * WebSocket readyState value for an open (connected) socket.
 * Replaces the magic number `1` used in readyState checks across the codebase.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/readyState
 */
export const WS_OPEN = 1;

/**
 * Broadcast a JSON string to all OPEN WebSockets in an iterable.
 * Silently skips any socket that is closing or already closed.
 * @param {Iterable<import("ws").WebSocket>} viewers - Any iterable of WebSocket instances.
 * @param {string} msg - Pre-serialised message string to send.
 */
export function broadcast(viewers, msg) {
  for (const ws of viewers) {
    if (ws.readyState === WS_OPEN) ws.send(msg);
  }
}
