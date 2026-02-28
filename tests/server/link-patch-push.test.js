import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, doHandshake, waitForClose } from "../helpers/setup-server.js";

/**
 * Tests for the PATCH /api/links/:id and PATCH /api/clients/:id endpoints.
 *
 * Key behaviour:
 *   - PATCH link updates the DB template only — does NOT push to connected clients.
 *   - PATCH client pushes load/unload immediately to connected clients.
 *   - PATCH client for a disconnected client persists in DB for the next reconnect.
 */
describe("Link and client PATCH behaviour", () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    await ctx.close();
  });

  // ---------- PATCH /api/links — must NOT push to connected clients ----------

  it("PATCH link does not push load to connected client", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { collector } = await doHandshake(ws, link);

      // Set up a listener for any unexpected load message
      let unexpectedLoad = false;
      const loadPromise = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 500);
        collector.wait((m) => m.type === "load" && m.name === "spider")
          .then(() => { unexpectedLoad = true; clearTimeout(timer); resolve(true); })
          .catch(() => resolve(false));
      });

      await fetch(`${ctx.baseUrl}/api/links/${link.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payloads: ["domviewer", "spider"] }),
      });

      const received = await loadPromise;
      expect(received).toBe(false);
      expect(unexpectedLoad).toBe(false);
    } finally {
      ws.close();
    }
  });

  it("PATCH link does not push unload to connected client", async () => {
    const link = await ctx.createLink(["domviewer", "spider"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { collector } = await doHandshake(ws, link);

      let unexpectedUnload = false;
      const unloadPromise = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 500);
        collector.wait((m) => m.type === "unload" && m.name === "spider")
          .then(() => { unexpectedUnload = true; clearTimeout(timer); resolve(true); })
          .catch(() => resolve(false));
      });

      await fetch(`${ctx.baseUrl}/api/links/${link.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payloads: ["domviewer"] }),
      });

      const received = await unloadPromise;
      expect(received).toBe(false);
      expect(unexpectedUnload).toBe(false);
    } finally {
      ws.close();
    }
  });

  // ---------- PATCH /api/clients — must push to connected clients ----------

  it("PATCH client adds payload -> connected client receives load", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId, collector } = await doHandshake(ws, link);

      const loadPromise = collector.wait((m) => m.type === "load" && m.name === "spider");

      await fetch(`${ctx.baseUrl}/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payloads: ["domviewer", "spider"] }),
      });

      const msg = await loadPromise;
      expect(msg.type).toBe("load");
      expect(msg.name).toBe("spider");

      // DB should reflect the new payloads
      expect(ctx.clients.get(clientId).payloads).toEqual(["domviewer", "spider"]);
    } finally {
      ws.close();
    }
  });

  it("PATCH client removes payload -> connected client receives unload", async () => {
    const link = await ctx.createLink(["domviewer", "spider"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId, collector } = await doHandshake(ws, link);

      const unloadPromise = collector.wait((m) => m.type === "unload" && m.name === "spider");

      await fetch(`${ctx.baseUrl}/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payloads: ["domviewer"] }),
      });

      const msg = await unloadPromise;
      expect(msg.type).toBe("unload");
      expect(msg.name).toBe("spider");

      // DB should reflect the new payloads
      expect(ctx.clients.get(clientId).payloads).toEqual(["domviewer"]);
    } finally {
      ws.close();
    }
  });

  it("PATCH client for disconnected client persists payloads in DB", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, link);

    // Disconnect
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(ctx.clients.get(clientId).connected).toBe(false);

    // PATCH while disconnected
    const res = await fetch(`${ctx.baseUrl}/api/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["domviewer", "spider"] }),
    });
    expect(res.status).toBe(200);

    // DB should now reflect the new payloads
    expect(ctx.clients.get(clientId).payloads).toEqual(["domviewer", "spider"]);
  });

  it("PATCH client returns 404 for unknown client", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/clients/nonexistent`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["domviewer"] }),
    });
    expect(res.status).toBe(404);
  });
});
