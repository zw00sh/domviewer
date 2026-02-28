import { WebSocket } from "ws";
import { createServer } from "../../server/index.js";
import { encodeBinaryFrame } from "../../shared/binary-frame.js";

/**
 * Starts both C2 and management servers on ephemeral ports with an in-memory SQLite database.
 * Returns a test context with helpers for creating links and connecting WebSockets.
 *
 * URL properties:
 *   ctx.baseUrl    — management server HTTP URL (backward-compat alias for mgmtBaseUrl)
 *   ctx.wsUrl      — management server WS URL  (backward-compat alias for mgmtWsUrl)
 *   ctx.c2BaseUrl  — C2 server HTTP URL
 *   ctx.c2WsUrl    — C2 server WS URL
 *
 * State proxy properties (combine DB + runtime state for test assertions):
 *   ctx.links      — Map-like proxy backed by the DB (get, has, size, values)
 *   ctx.clients    — Map-like proxy: DB metadata + live payloads/ws from activeClients
 *   ctx.globalLogs — Array snapshot from DB (refreshed on each access)
 */
export async function startTestServer() {
  const { db, state, c2, management } = await createServer({ dbPath: ":memory:" });

  // Map-like proxy for links — reads from DB on every access
  const links = {
    get(id) { return db.getLink(id); },
    has(id) { return db.getLink(id) !== null; },
    get size() { return db.getAllLinks().length; },
    values() { return db.getAllLinks()[Symbol.iterator](); },
  };

  // Map-like proxy for clients — merges DB record with runtime state from activeClients
  const clients = {
    get(id) {
      const dbClient = db.getClient(id);
      if (!dbClient) return undefined;
      const active = state.activeClients.get(id);
      return {
        linkId: dbClient.linkId,
        connectedAt: dbClient.connectedAt,
        connected: !!active,
        ws: active?.ws,
        // Payloads: persisted string array from DB (per-client config)
        payloads: dbClient.payloads,
        // Config: per-client config object from DB
        config: dbClient.config,
        // Origin and IP captured from the init message / socket
        origin: dbClient.origin,
        ip: dbClient.ip,
        // activePayloads: runtime handler state objects from activeClients (ydoc, results, etc.)
        activePayloads: active?.payloads || {},
        // Getter so each access fetches fresh data from DB
        get logs() { return db.getClientLogs(id, 200); },
      };
    },
    has(id) { return db.getClient(id) !== null; },
  };

  return new Promise((resolve) => {
    c2.server.listen(0, () => {
      const c2Port = c2.server.address().port;

      management.server.listen(0, () => {
        const mgmtPort = management.server.address().port;

        const c2BaseUrl = `http://127.0.0.1:${c2Port}`;
        const c2WsUrl = `ws://127.0.0.1:${c2Port}`;
        const mgmtBaseUrl = `http://127.0.0.1:${mgmtPort}`;
        const mgmtWsUrl = `ws://127.0.0.1:${mgmtPort}`;

        const ctx = {
          // Backward-compatible aliases
          baseUrl: mgmtBaseUrl,
          wsUrl: mgmtWsUrl,
          // Explicit server URLs
          c2BaseUrl,
          c2WsUrl,
          mgmtBaseUrl,
          mgmtWsUrl,
          // State proxies for test assertions
          links,
          clients,
          get globalLogs() { return db.getGlobalLogs(500); },
          db,

          /** Create a payload link via the management API. */
          async createLink(payloads = ["domviewer"]) {
            const res = await fetch(`${mgmtBaseUrl}/api/links`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ payloads }),
            });
            return res.json();
          },

          /** Connect a payload WebSocket to the C2 server. */
          connectPayloadWs() {
            return new Promise((res, rej) => {
              const ws = new WebSocket(`${c2WsUrl}/ws`);
              ws.on("open", () => res(ws));
              ws.on("error", rej);
            });
          },

          /** Connect a viewer WebSocket to the management server. */
          connectViewerWs(clientId, payload = "domviewer") {
            return new Promise((res, rej) => {
              const ws = new WebSocket(
                `${mgmtWsUrl}/view?id=${clientId}&payload=${payload}`
              );
              ws.on("open", () => res(ws));
              ws.on("error", rej);
            });
          },

          /** Connect a log viewer WebSocket to the management server. */
          connectLogViewerWs(clientId = null) {
            return new Promise((res, rej) => {
              const params = clientId
                ? `?id=${clientId}&payload=logs`
                : "?payload=logs";
              const ws = new WebSocket(`${mgmtWsUrl}/view${params}`);
              ws.on("open", () => res(ws));
              ws.on("error", rej);
            });
          },

          /** Close both servers and the database. */
          close() {
            return new Promise((res) => {
              c2.server.close(() => {
                management.server.close(() => {
                  db.close();
                  res();
                });
              });
            });
          },
        };

        resolve(ctx);
      });
    });
  });
}

/**
 * Creates a buffered message collector on a WebSocket.
 * Messages that arrive before a wait() call is pending are queued.
 */
export function createMessageCollector(ws) {
  const buffer = [];
  let waiting = null;

  ws.on("message", (data) => {
    const text = data.toString();
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (waiting && waiting.predicate(msg)) {
      const { resolve, timer } = waiting;
      waiting = null;
      clearTimeout(timer);
      resolve(msg);
    } else {
      buffer.push(msg);
    }
  });

  return {
    wait(predicate, timeout = 3000) {
      // Check buffer first
      const idx = buffer.findIndex(predicate);
      if (idx !== -1) {
        return Promise.resolve(buffer.splice(idx, 1)[0]);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting = null;
          reject(new Error("waitForMessage timed out"));
        }, timeout);
        waiting = { predicate, resolve, timer };
      });
    },
  };
}

export function waitForMessage(ws, predicate, timeout = 3000) {
  return createMessageCollector(ws).wait(predicate, timeout);
}

export function waitForClose(ws, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("waitForClose timed out")), timeout);
    ws.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Build a binary frame with the payload name prefix.
 * Delegates to encodeBinaryFrame from shared/binary-frame.js.
 * Kept as a named export for backward compatibility with existing tests.
 * @param {string} name - Payload name.
 * @param {Uint8Array} data - Binary payload data.
 * @returns {Uint8Array}
 */
export function makeBinaryFrame(name, data) {
  return encodeBinaryFrame(name, data);
}

/**
 * Performs the WS init handshake and waits for the load messages.
 *
 * Accepts either a full link object (with .id and .payloads) or a bare linkId string.
 * When a link object is provided, the expected load count is derived from link.payloads.length.
 * When a string is provided, opts.payloadCount controls how many loads to await (default: 1).
 *
 * @param {import("ws").WebSocket} ws
 * @param {string | { id: string, payloads: string[] }} linkOrId
 * @param {string} [existingClientId] - Reuse an existing client ID (for reconnect tests).
 *   When provided, `reconnect: true` is sent so the server applies its "verify record exists" check.
 * @param {object} [opts] - Additional options.
 * @param {string} [opts.origin] - Override the origin field (defaults to 'http://test-origin.example.com').
 * @param {number} [opts.payloadCount] - Number of load messages to await (only used when linkOrId is a string).
 */
export async function doHandshake(ws, linkOrId, existingClientId = null, opts = {}) {
  const linkId = typeof linkOrId === "string" ? linkOrId : linkOrId.id;
  // Derive expected load count from the link object, or fall back to an explicit count / default of 1
  const payloadCount =
    typeof linkOrId === "object" && Array.isArray(linkOrId.payloads)
      ? linkOrId.payloads.length
      : (opts.payloadCount ?? 1);

  const clientId = existingClientId || crypto.randomUUID();
  // Treat re-using an existing ID as a reconnect so the server verifies the record
  const reconnect = !!existingClientId;
  const origin = opts.origin ?? 'http://test-origin.example.com';
  const collector = createMessageCollector(ws);

  ws.send(JSON.stringify({ type: "init", clientId, linkId, reconnect, origin }));

  const messages = [];
  for (let i = 0; i < payloadCount; i++) {
    const loadMsg = await collector.wait((m) => m.type === "load");
    messages.push(loadMsg);
  }

  return { clientId, messages, collector };
}
