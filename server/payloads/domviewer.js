import { broadcast } from "../ws-utils.js";
import {
  forwardToViewers,
  createOnBinary,
  pushToAllViewers,
} from "./_dom-stream-base.js";

export { pushToAllViewers };

/**
 * Initialize per-client domviewer handler state.
 * State is ephemeral — rebuilt from client snapshots on each connection.
 * @param {object} _db
 * @param {string} clientId
 * @param {Function} [storeLog]
 * @returns {{ nodes: Map<string, object>, meta: object, viewers: Set<import("ws").WebSocket>, clientId: string, storeLog: Function }}
 */
export function initState(_db, clientId, storeLog = () => {}) {
  return { nodes: new Map(), meta: {}, viewers: new Set(), clientId, storeLog };
}

/**
 * Handle a binary JSON-encoded frame from the client.
 * Decodes the message, applies it to local state, and forwards to viewers.
 */
export const onBinary = createOnBinary("domviewer");

/**
 * Handle a new viewer WebSocket connecting.
 * Sends the current state as a JSON snapshot and registers for future pushes.
 * @param {{ nodes: Map, meta: object, viewers: Set }} state
 * @param {import("ws").WebSocket} ws
 */
export function onViewerConnect(state, ws) {
  state.viewers.add(ws);
  ws.send(JSON.stringify({
    type: "snapshot",
    nodes: Object.fromEntries(state.nodes),
    meta: state.meta,
  }));
  ws.on("close", () => state.viewers.delete(ws));
}

/**
 * Called after the client has loaded all payloads.
 * On reconnect: the server-side state is empty (ephemeral), so we request a full
 * DOM snapshot from the client to repopulate it immediately.
 * @param {{ nodes: Map, meta: object, viewers: Set }} state
 * @param {{ isReconnect: boolean, sendToClient: Function }} opts
 */
export function onConnect(state, { isReconnect, sendToClient }) {
  if (isReconnect) {
    sendToClient({ type: "request-sync" });
  }
}
