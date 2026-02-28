import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startTestServer,
  doHandshake,
  waitForMessage,
  waitForClose,
} from "../helpers/setup-server.js";

/**
 * Tests for DELETE /api/links/:id and DELETE /api/clients/:id.
 */
describe("DELETE endpoints", () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    await ctx.close();
  });

  // ---------- DELETE /api/links/:id ----------

  it("DELETE link returns 404 for unknown link", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/links/nonexistent`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("DELETE link removes link from DB", async () => {
    const link = await ctx.createLink(["domviewer"]);
    expect(ctx.links.has(link.id)).toBe(true);

    const res = await fetch(`${ctx.baseUrl}/api/links/${link.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(ctx.links.has(link.id)).toBe(false);
  });

  it("DELETE link does not delete associated clients", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link.id);
      expect(ctx.clients.has(clientId)).toBe(true);

      await fetch(`${ctx.baseUrl}/api/links/${link.id}`, { method: "DELETE" });

      // Link should be gone
      expect(ctx.links.has(link.id)).toBe(false);
      // Client should still exist — it is independent of its originating link
      expect(ctx.clients.has(clientId)).toBe(true);
      expect(ctx.clients.get(clientId).connected).toBe(true);
    } finally {
      ws.close();
    }
  });

  it("DELETE link with no connected clients succeeds", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const res = await fetch(`${ctx.baseUrl}/api/links/${link.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(ctx.links.has(link.id)).toBe(false);
  });

  // ---------- DELETE /api/clients/:id ----------

  it("DELETE client returns 404 for unknown client", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/clients/nonexistent`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("DELETE client removes client from DB", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link.id);
      expect(ctx.clients.has(clientId)).toBe(true);

      const closePromise = waitForClose(ws);

      const res = await fetch(`${ctx.baseUrl}/api/clients/${clientId}`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);

      await closePromise;
      expect(ctx.clients.has(clientId)).toBe(false);
    } finally {
      ws.close();
    }
  });

  it("DELETE client sends destroy message to connected client", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link.id);

      const destroyPromise = waitForMessage(ws, (m) => m.type === "destroy");

      await fetch(`${ctx.baseUrl}/api/clients/${clientId}`, {
        method: "DELETE",
      });

      const msg = await destroyPromise;
      expect(msg.type).toBe("destroy");
    } finally {
      ws.close();
    }
  });

  it("DELETE client for disconnected client removes from DB", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, link.id);

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(ctx.clients.has(clientId)).toBe(true);
    expect(ctx.clients.get(clientId).connected).toBe(false);

    const res = await fetch(`${ctx.baseUrl}/api/clients/${clientId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(ctx.clients.has(clientId)).toBe(false);
  });

  it("DELETE client does not affect the link", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, link.id);

    ws.close();
    await new Promise((r) => setTimeout(r, 100));

    await fetch(`${ctx.baseUrl}/api/clients/${clientId}`, { method: "DELETE" });

    // Link should still exist
    expect(ctx.links.has(link.id)).toBe(true);
  });

  it("reconnecting client whose record was deleted receives destroy", async () => {
    const link = await ctx.createLink(["domviewer"]);

    // First connection
    const ws1 = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws1, link.id);
    ws1.close();
    await new Promise((r) => setTimeout(r, 100));

    // Delete the client record
    await fetch(`${ctx.baseUrl}/api/clients/${clientId}`, { method: "DELETE" });
    expect(ctx.clients.has(clientId)).toBe(false);

    // Reconnect with the same clientId and reconnect=true (simulates localStorage persistence)
    const ws2 = await ctx.connectPayloadWs();
    const destroyPromise = waitForMessage(ws2, (m) => m.type === "destroy");
    const closePromise = waitForClose(ws2);

    ws2.send(JSON.stringify({ type: "init", clientId, linkId: link.id, reconnect: true }));

    const msg = await destroyPromise;
    expect(msg.type).toBe("destroy");
    await closePromise;

    // Client should NOT be re-created in the DB
    expect(ctx.clients.has(clientId)).toBe(false);
  });
});
