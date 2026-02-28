/**
 * Codec helpers for binary frame payloads.
 *
 * Replaces msgpack with JSON + TextEncoder/TextDecoder (browser/Node builtins).
 * These functions are isomorphic and used by both client payloads (encode path)
 * and server handlers (decode path).
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Encode a message object to a UTF-8 Uint8Array via JSON.
 * @param {object} obj
 * @returns {Uint8Array}
 */
export function encodeMessage(obj) {
  return encoder.encode(JSON.stringify(obj));
}

/**
 * Decode a UTF-8 binary buffer to a message object via JSON.
 * @param {Uint8Array|Buffer|ArrayBuffer} data
 * @returns {object}
 */
export function decodeMessage(data) {
  return JSON.parse(decoder.decode(data));
}
