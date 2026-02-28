/**
 * Isomorphic binary frame encode/decode utilities.
 *
 * Frame format: [1 byte: name length N][N bytes: name UTF-8][rest: binary data]
 *
 * Used by:
 *   - client/loader.js  (bundled by esbuild for the browser)
 *   - server/c2.js      (Node.js — direct import)
 *   - tests/helpers/setup-server.js (test helper)
 */

/**
 * Encode a binary frame with a name prefix.
 * @param {string} name - Payload name (must encode to ≤255 UTF-8 bytes).
 * @param {Uint8Array} data - Binary payload data.
 * @returns {Uint8Array} Encoded frame.
 * @throws {Error} If the name encodes to more than 255 UTF-8 bytes.
 */
export function encodeBinaryFrame(name, data) {
  const nameBytes = new TextEncoder().encode(name);
  if (nameBytes.length > 255) {
    throw new Error(
      `Payload name too long: "${name}" encodes to ${nameBytes.length} bytes (max 255)`
    );
  }
  const frame = new Uint8Array(1 + nameBytes.length + data.length);
  frame[0] = nameBytes.length;
  frame.set(nameBytes, 1);
  frame.set(data, 1 + nameBytes.length);
  return frame;
}

/**
 * Decode a binary frame, extracting the name prefix and data payload.
 * Returns null if the buffer is too short or otherwise malformed.
 * Accepts Uint8Array, Buffer (Node.js), or ArrayBuffer (browser WebSocket).
 * @param {Uint8Array|ArrayBuffer} buf
 * @returns {{ name: string, data: Uint8Array } | null}
 */
export function decodeBinaryFrame(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < 2) return null;
  const nameLen = bytes[0];
  if (bytes.length < 1 + nameLen) return null;
  const name = new TextDecoder().decode(bytes.slice(1, 1 + nameLen));
  const data = bytes.slice(1 + nameLen);
  return { name, data };
}
