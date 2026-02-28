/**
 * Shared base utilities for DOM-streaming payload handlers (domviewer and proxy).
 *
 * Both handlers receive binary snapshot/delta/meta frames from the client, apply
 * them to a local node map, and forward the decoded message to connected viewers.
 * The only difference is the log source string used when recording debug/error entries.
 *
 * Exported:
 *   forwardToViewers(state, msg)   — broadcast a decoded message to all viewers as JSON
 *   createOnBinary(source)         — factory returning an onBinary handler for the given source
 *   pushToAllViewers(state)        — broadcast the current full snapshot to all viewers
 */
import { decodeMessage } from "../../shared/codec.js";
import { applyMessage } from "../../shared/apply-delta.js";
import { broadcast } from "../ws-utils.js";

/**
 * Forward a decoded message to all connected viewers as JSON.
 * Converts Map-typed node values to plain objects before serialising.
 * @param {{ viewers: Set<import("ws").WebSocket> }} state
 * @param {object} msg - Decoded delta/snapshot/meta message
 */
export function forwardToViewers(state, msg) {
  if (state.viewers.size === 0) return;
  const json = JSON.stringify(msg, (key, value) => {
    if (value instanceof Map) return Object.fromEntries(value);
    return value;
  });
  broadcast(state.viewers, json);
}

/**
 * Create an `onBinary` handler for a DOM-streaming payload.
 * Decodes the binary frame, applies it to state, logs the update, and forwards to viewers.
 *
 * @param {string} source - Log source string (e.g. "domviewer" or "proxy")
 * @returns {(state: object, data: Uint8Array, _pushToViewers: Function) => void}
 */
export function createOnBinary(source) {
  /**
   * @param {{ nodes: Map, meta: object, viewers: Set, clientId: string, storeLog: Function }} state
   * @param {Uint8Array} data - JSON-encoded UTF-8 snapshot/delta/meta message
   * @param {Function} _pushToViewers - Unused (we forward directly after decode)
   */
  return function onBinary(state, data, _pushToViewers) {
    try {
      const msg = decodeMessage(data);
      applyMessage(state.nodes, state.meta, msg);
      state.storeLog(state.clientId, {
        level: "debug",
        source,
        message: `Update (${msg.type}) — ${state.nodes.size} nodes`,
        timestamp: Date.now(),
      });
      forwardToViewers(state, msg);
    } catch (err) {
      state.storeLog(state.clientId, {
        level: "error",
        source,
        message: `Failed to decode/apply update: ${err.message}`,
        timestamp: Date.now(),
      });
    }
  };
}

/**
 * Push the current DOM state as a full snapshot to all connected viewers.
 * @param {{ nodes: Map, meta: object, viewers: Set<import("ws").WebSocket> }} state
 */
export function pushToAllViewers(state) {
  if (state.viewers.size === 0) return;
  broadcast(state.viewers, JSON.stringify({
    type: "snapshot",
    nodes: Object.fromEntries(state.nodes),
    meta: state.meta,
  }));
}
