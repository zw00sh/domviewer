import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startTestServer,
  doHandshake,
} from "../helpers/setup-server.js";

describe("Dashboard WS subscription", () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("receives init with links and clients arrays on connect", async () => {
    const { ws, collector, ready } = ctx.connectDashboardWs();
    await ready;

    const msg = await collector.wait((m) => m.type === "init");
    expect(Array.isArray(msg.links)).toBe(true);
    expect(Array.isArray(msg.clients)).toBe(true);

    ws.close();
  });

  it("receives link-created after POST /api/links", async () => {
    const { ws, collector, ready } = ctx.connectDashboardWs();
    await ready;
    await collector.wait((m) => m.type === "init");

    const res = await fetch(`${ctx.baseUrl}/api/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["domviewer"] }),
    });
    const created = await res.json();

    const msg = await collector.wait((m) => m.type === "link-created");
    expect(msg.link.id).toBe(created.id);
    expect(msg.link.payloads).toContain("domviewer");

    ws.close();
  });

  it("receives link-updated after PATCH /api/links/:id", async () => {
    const link = await ctx.createLink(["domviewer"]);

    const { ws, collector, ready } = ctx.connectDashboardWs();
    await ready;
    await collector.wait((m) => m.type === "init");

    await fetch(`${ctx.baseUrl}/api/links/${link.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["domviewer", "spider"] }),
    });

    const msg = await collector.wait((m) => m.type === "link-updated");
    expect(msg.link.id).toBe(link.id);
    expect(msg.link.payloads).toContain("spider");

    ws.close();
  });

  it("receives link-deleted after DELETE /api/links/:id", async () => {
    const link = await ctx.createLink(["domviewer"]);

    const { ws, collector, ready } = ctx.connectDashboardWs();
    await ready;
    await collector.wait((m) => m.type === "init");

    await fetch(`${ctx.baseUrl}/api/links/${link.id}`, { method: "DELETE" });

    const msg = await collector.wait((m) => m.type === "link-deleted");
    expect(msg.linkId).toBe(link.id);

    ws.close();
  });

  it("receives client-connected when C2 client connects", async () => {
    const link = await ctx.createLink(["domviewer"]);

    const { ws, collector, ready } = ctx.connectDashboardWs();
    await ready;
    await collector.wait((m) => m.type === "init");

    const payloadWs = await ctx.connectPayloadWs();
    try {
      const { clientId } = await doHandshake(payloadWs, link);

      const msg = await collector.wait((m) => m.type === "client-connected");
      expect(msg.client.id).toBe(clientId);
      expect(msg.client.connected).toBe(true);
    } finally {
      payloadWs.close();
    }

    ws.close();
  });

  it("receives client-disconnected when C2 client disconnects", async () => {
    const link = await ctx.createLink(["domviewer"]);

    const payloadWs = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(payloadWs, link);

    const { ws, collector, ready } = ctx.connectDashboardWs();
    await ready;
    await collector.wait((m) => m.type === "init");

    payloadWs.close();

    const msg = await collector.wait((m) => m.type === "client-disconnected");
    expect(msg.client.id).toBe(clientId);
    expect(msg.client.connected).toBe(false);

    ws.close();
  });

  it("receives client-updated after PATCH /api/clients/:id", async () => {
    const link = await ctx.createLink(["domviewer"]);

    const payloadWs = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(payloadWs, link);

    const { ws, collector, ready } = ctx.connectDashboardWs();
    await ready;
    await collector.wait((m) => m.type === "init");

    await fetch(`${ctx.baseUrl}/api/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["domviewer", "spider"] }),
    });

    const msg = await collector.wait((m) => m.type === "client-updated");
    expect(msg.client.id).toBe(clientId);
    expect(msg.client.payloads).toContain("spider");

    payloadWs.close();
    ws.close();
  });

  it("receives client-deleted after DELETE /api/clients/:id", async () => {
    const link = await ctx.createLink(["domviewer"]);

    const payloadWs = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(payloadWs, link);

    const { ws, collector, ready } = ctx.connectDashboardWs();
    await ready;
    await collector.wait((m) => m.type === "init");

    await fetch(`${ctx.baseUrl}/api/clients/${clientId}`, { method: "DELETE" });

    const msg = await collector.wait((m) => m.type === "client-deleted");
    expect(msg.clientId).toBe(clientId);

    ws.close();
  });

  it("init snapshot includes pre-existing links and clients", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const payloadWs = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(payloadWs, link);

    const { ws, collector, ready } = ctx.connectDashboardWs();
    await ready;

    const msg = await collector.wait((m) => m.type === "init");
    expect(msg.links.some((l) => l.id === link.id)).toBe(true);
    expect(msg.clients.some((c) => c.id === clientId && c.connected)).toBe(true);

    payloadWs.close();
    ws.close();
  });
});
