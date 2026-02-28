import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, waitForMessage, waitForClose, doHandshake } from "../helpers/setup-server.js";

describe("WS handshake", () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("bug regression: text init message is not misrouted as binary", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();

    try {
      // Start listening BEFORE sending init
      const loadPromise = waitForMessage(ws, (m) => m.type === "load");

      ws.send(JSON.stringify({
        type: "init",
        clientId: crypto.randomUUID(),
        linkId: link.id,
      }));

      const msg = await loadPromise;
      expect(msg.type).toBe("load");
      expect(msg.name).toBe("domviewer");
    } finally {
      ws.close();
    }
  });

  it("init receives load messages for each payload", async () => {
    const link = await ctx.createLink(["domviewer", "spider"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { messages } = await doHandshake(ws, link);
      const loadedNames = messages.map((m) => m.name);
      expect(loadedNames).toContain("domviewer");
      expect(loadedNames).toContain("spider");
      // All messages must be load type
      expect(messages.every((m) => m.type === "load")).toBe(true);
    } finally {
      ws.close();
    }
  });

  it("init with unknown linkId closes WS", async () => {
    const ws = await ctx.connectPayloadWs();
    const closePromise = waitForClose(ws);

    ws.send(JSON.stringify({
      type: "init",
      clientId: crypto.randomUUID(),
      linkId: "nonexistent-link-id",
    }));

    await closePromise;
  });

  it("client appears in clients map after init", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);
      expect(ctx.clients.has(clientId)).toBe(true);
      expect(ctx.clients.get(clientId).connected).toBe(true);
    } finally {
      ws.close();
    }
  });

  it("client marked disconnected on WS close", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, link);

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(ctx.clients.get(clientId).connected).toBe(false);
  });

  it("reconnect uses client's persisted payloads, not link's current payloads", async () => {
    // Create a link with only domviewer
    const link = await ctx.createLink(["domviewer"]);
    const ws1 = await ctx.connectPayloadWs();
    const { clientId, messages: msgs1 } = await doHandshake(ws1, link);

    // Verify first connect gets domviewer
    expect(msgs1.map((m) => m.name)).toEqual(["domviewer"]);

    // Disconnect
    ws1.close();
    await new Promise((r) => setTimeout(r, 100));

    // PATCH the link to add spider — existing clients should not be affected on reconnect
    await fetch(`${ctx.baseUrl}/api/links/${link.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["domviewer", "spider"] }),
    });

    // Reconnect with the same clientId.
    // link.payloads is still ["domviewer"] (the JS object was not mutated by the PATCH),
    // which matches the client's persisted payload list — so doHandshake waits for 1 load.
    const ws2 = await ctx.connectPayloadWs();
    const { messages: msgs2 } = await doHandshake(ws2, link, clientId);
    ws2.close();

    // Should still get the client's original payloads (domviewer only)
    expect(msgs2.map((m) => m.name)).toEqual(["domviewer"]);
  });

  it("new client on updated link gets link's current payloads", async () => {
    // Create a link and update it before any client connects
    const link = await ctx.createLink(["domviewer"]);
    await fetch(`${ctx.baseUrl}/api/links/${link.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["domviewer", "spider"] }),
    });

    // A brand-new client (different UUID) should get the link's updated payloads.
    // The link object has the original payloads, so pass payloadCount explicitly.
    const ws = await ctx.connectPayloadWs();
    try {
      const { messages } = await doHandshake(ws, link.id, null, { payloadCount: 2 });
      const loadedNames = messages.map((m) => m.name);
      expect(loadedNames).toContain("domviewer");
      expect(loadedNames).toContain("spider");
    } finally {
      ws.close();
    }
  });
});
