import { describe, it, expect, afterEach } from "vitest";
import {
  startTestServer,
  doHandshake,
  createMessageCollector,
} from "../helpers/setup-server.js";

let ctx;

afterEach(async () => {
  if (ctx) await ctx.close();
  ctx = null;
});

describe("Config propagation", () => {
  it("POST /api/links with config stores it in DB", async () => {
    ctx = await startTestServer();
    const res = await fetch(`${ctx.baseUrl}/api/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payloads: ["spider"],
        config: { spider: { exfiltrate: true, limitTypes: false, maxFileSize: 5242880 } },
      }),
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.config?.spider?.exfiltrate).toBe(true);

    const link = ctx.links.get(data.id);
    expect(link.config?.spider?.exfiltrate).toBe(true);
  });

  it("Client inherits link config on first connect", async () => {
    ctx = await startTestServer();

    // Create link with exfiltrate enabled
    const linkRes = await fetch(`${ctx.baseUrl}/api/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payloads: ["spider"],
        config: { spider: { exfiltrate: true } },
      }),
    });
    const { id: linkId } = await linkRes.json();

    // Connect payload WS and complete handshake
    const ws = await ctx.connectPayloadWs();
    try {
      const { clientId } = await doHandshake(ws, linkId);

      const client = ctx.clients.get(clientId);
      expect(client).toBeTruthy();
      expect(client.config?.spider?.exfiltrate).toBe(true);
    } finally {
      ws.close();
    }
  });

  it("Load message includes per-payload config", async () => {
    ctx = await startTestServer();

    const linkRes = await fetch(`${ctx.baseUrl}/api/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payloads: ["spider"],
        config: { spider: { exfiltrate: true, limitTypes: false } },
      }),
    });
    const { id: linkId } = await linkRes.json();

    const ws = await ctx.connectPayloadWs();
    try {
      // doHandshake awaits all load messages and returns the internal collector
      const { messages } = await doHandshake(ws, linkId);

      // Find the load message for the spider payload
      const loadMsg = messages.find((m) => m.type === "load" && m.name === "spider");
      expect(loadMsg).toBeTruthy();
      expect(loadMsg.config).toBeDefined();
      expect(loadMsg.config.exfiltrate).toBe(true);
      expect(loadMsg.config.limitTypes).toBe(false);
    } finally {
      ws.close();
    }
  });

  it("PATCH /api/clients/:id with config pushes config message to connected client", async () => {
    ctx = await startTestServer();

    const { id: linkId } = await ctx.createLink(["spider"]);
    const ws = await ctx.connectPayloadWs();
    try {
      // Use the collector returned by doHandshake to avoid missed-message race conditions
      const { clientId, collector } = await doHandshake(ws, linkId);

      // Set up the wait BEFORE making the PATCH request to avoid the race
      const configPromise = collector.wait(
        (m) => m.type === "payload" && m.name === "spider" && m.data?.type === "config",
        3000
      );

      // PATCH the client config — server should push a config message immediately
      const patchRes = await fetch(`${ctx.baseUrl}/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { spider: { exfiltrate: true } } }),
      });
      expect(patchRes.status).toBe(200);

      const configMsg = await configPromise;
      expect(configMsg.data.exfiltrate).toBe(true);

      // Verify the DB was updated
      const updated = ctx.clients.get(clientId);
      expect(updated.config?.spider?.exfiltrate).toBe(true);
    } finally {
      ws.close();
    }
  });

  it("PATCH /api/links/:id with config stores it in DB", async () => {
    ctx = await startTestServer();
    const { id: linkId } = await ctx.createLink(["spider"]);

    const res = await fetch(`${ctx.baseUrl}/api/links/${linkId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["spider"], config: { spider: { exfiltrate: true } } }),
    });
    expect(res.status).toBe(200);

    const link = ctx.links.get(linkId);
    expect(link.config?.spider?.exfiltrate).toBe(true);
  });
});
