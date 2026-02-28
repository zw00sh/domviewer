import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { startTestServer, doHandshake } from "../helpers/setup-server.js";

describe("client origin and IP tracking", () => {
  let ctx;

  beforeEach(async () => {
    ctx = await startTestServer();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("stores origin and a truthy IP on first connect", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();

    const { clientId } = await doHandshake(ws, link.id, null, {
      origin: "https://example.com",
    });

    const client = ctx.clients.get(clientId);
    expect(client).toBeDefined();
    expect(client.origin).toBe("https://example.com");
    // IP will be loopback — truthy but exact value varies (::1 or 127.0.0.1)
    expect(client.ip).toBeTruthy();

    ws.close();
  });

  it("updates origin and IP on reconnect", async () => {
    const link = await ctx.createLink(["domviewer"]);

    // First connect
    const ws1 = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws1, link.id, null, {
      origin: "https://first-origin.example.com",
    });
    ws1.close();
    // Wait a tick for the close to propagate
    await new Promise((r) => setTimeout(r, 50));

    // Reconnect with different origin
    const ws2 = await ctx.connectPayloadWs();
    await doHandshake(ws2, link.id, clientId, {
      origin: "https://second-origin.example.com",
    });

    const client = ctx.clients.get(clientId);
    expect(client.origin).toBe("https://second-origin.example.com");
    expect(client.ip).toBeTruthy();

    ws2.close();
  });

  it("includes origin and ip in GET /api/clients", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, link.id, null, {
      origin: "https://list-test.example.com",
    });

    const res = await fetch(`${ctx.baseUrl}/api/clients`);
    const clients = await res.json();
    const found = clients.find((c) => c.id === clientId);

    expect(found).toBeDefined();
    expect(found.origin).toBe("https://list-test.example.com");
    expect(found.ip).toBeTruthy();

    ws.close();
  });

  it("includes origin and ip in GET /api/clients/:id", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, link.id, null, {
      origin: "https://single-test.example.com",
    });

    const res = await fetch(`${ctx.baseUrl}/api/clients/${clientId}`);
    const client = await res.json();

    expect(client.origin).toBe("https://single-test.example.com");
    expect(client.ip).toBeTruthy();

    ws.close();
  });
});
