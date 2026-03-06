/**
 * Integration tests for the cookies payload WS flow.
 * Tests the full cycle: client connects → sends cookie changes → viewer receives them.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { startTestServer, doHandshake } from "../helpers/setup-server.js";

/**
 * Connect a viewer WS for cookies and return helpers for receiving messages.
 */
function connectCookiesViewer(wsUrl, clientId) {
  const url = `${wsUrl}/view?id=${clientId}&payload=cookies`;
  const ws = new WebSocket(url);

  let firstMsgResolve;
  const firstMsg = new Promise((r) => { firstMsgResolve = r; });
  let called = false;

  ws.on("message", (data) => {
    // Skip the client-info message sent before the handler's initial message
    const raw = data.toString();
    try { if (JSON.parse(raw).type === "client-info") return; } catch (_) {}
    if (!called) {
      called = true;
      firstMsgResolve(raw);
    }
  });

  const ready = new Promise((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
  });

  return {
    ws,
    firstMsg,
    ready,
    nextMsg() {
      return new Promise((resolve) => {
        ws.once("message", (d) => resolve(d.toString()));
      });
    },
  };
}

describe("cookies WS integration", () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("viewer receives init with empty cookies on connect", async () => {
    const link = await ctx.createLink(["cookies"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);
      const v = connectCookiesViewer(ctx.wsUrl, clientId);
      await v.ready;

      const raw = await v.firstMsg;
      const msg = JSON.parse(raw);
      expect(msg.type).toBe("init");
      expect(Array.isArray(msg.cookies)).toBe(true);
      expect(msg.cookies).toHaveLength(0);

      v.ws.close();
    } finally {
      ws.close();
    }
  });

  it("viewer receives incremental cookies after client sends them", async () => {
    const link = await ctx.createLink(["cookies"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);
      const v = connectCookiesViewer(ctx.wsUrl, clientId);
      await v.ready;
      await v.firstMsg; // consume init

      const nextPromise = v.nextMsg();

      ws.send(JSON.stringify({
        type: "payload",
        name: "cookies",
        data: {
          type: "cookies",
          cookies: [
            { name: "session", value: "abc123", timestamp: Date.now() },
            { name: "theme", value: "dark", timestamp: Date.now() + 1 },
          ],
        },
      }));

      const raw = await nextPromise;
      const msg = JSON.parse(raw);
      expect(msg.type).toBe("cookies");
      expect(msg.cookies).toHaveLength(2);
      expect(msg.cookies[0].name).toBe("session");
      expect(msg.cookies[1].name).toBe("theme");

      v.ws.close();
    } finally {
      ws.close();
    }
  });

  it("new viewer receives all persisted cookies in init", async () => {
    const link = await ctx.createLink(["cookies"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);

      // Send cookies before any viewer connects
      ws.send(JSON.stringify({
        type: "payload",
        name: "cookies",
        data: {
          type: "cookies",
          cookies: [
            { name: "auth_token", value: "secret-value", timestamp: Date.now() },
          ],
        },
      }));
      await new Promise((r) => setTimeout(r, 100));

      // New viewer connects — should receive all persisted cookies
      const v = connectCookiesViewer(ctx.wsUrl, clientId);
      await v.ready;
      const raw = await v.firstMsg;
      const msg = JSON.parse(raw);

      expect(msg.type).toBe("init");
      expect(msg.cookies).toHaveLength(1);
      expect(msg.cookies[0].name).toBe("auth_token");

      v.ws.close();
    } finally {
      ws.close();
    }
  });

  it("viewer clear command wipes cookies and notifies all viewers", async () => {
    const link = await ctx.createLink(["cookies"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);

      // Send some cookies first
      ws.send(JSON.stringify({
        type: "payload",
        name: "cookies",
        data: {
          type: "cookies",
          cookies: [
            { name: "session", value: "xyz", timestamp: Date.now() },
          ],
        },
      }));
      await new Promise((r) => setTimeout(r, 100));

      const v = connectCookiesViewer(ctx.wsUrl, clientId);
      await v.ready;
      await v.firstMsg; // consume init (has 1 cookie)

      const clearPromise = v.nextMsg();
      // Send clear command from viewer
      v.ws.send(JSON.stringify({ type: "clear" }));

      const raw = await clearPromise;
      const msg = JSON.parse(raw);
      expect(msg.type).toBe("cleared");

      // Verify DB is cleared: new viewer should get empty init
      const v2 = connectCookiesViewer(ctx.wsUrl, clientId);
      await v2.ready;
      const raw2 = await v2.firstMsg;
      const msg2 = JSON.parse(raw2);
      expect(msg2.type).toBe("init");
      expect(msg2.cookies).toHaveLength(0);

      v.ws.close();
      v2.ws.close();
    } finally {
      ws.close();
    }
  });

  it("REST GET /api/clients/:id/cookies/entries returns persisted cookies", async () => {
    const link = await ctx.createLink(["cookies"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);

      ws.send(JSON.stringify({
        type: "payload",
        name: "cookies",
        data: {
          type: "cookies",
          cookies: [
            { name: "preference", value: "light-mode", timestamp: Date.now() },
          ],
        },
      }));
      await new Promise((r) => setTimeout(r, 100));

      const res = await fetch(`${ctx.baseUrl}/api/clients/${clientId}/cookies/entries`);
      expect(res.status).toBe(200);
      const entries = await res.json();
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe("preference");
      expect(entries[0].value).toBe("light-mode");
      expect(entries[0].removed).toBe(false);
    } finally {
      ws.close();
    }
  });

  it("REST POST /api/clients/:id/cookies/clear deletes cookies", async () => {
    const link = await ctx.createLink(["cookies"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);

      ws.send(JSON.stringify({
        type: "payload",
        name: "cookies",
        data: {
          type: "cookies",
          cookies: [
            { name: "tracker", value: "val1", timestamp: Date.now() },
          ],
        },
      }));
      await new Promise((r) => setTimeout(r, 100));

      const clearRes = await fetch(
        `${ctx.baseUrl}/api/clients/${clientId}/cookies/clear`,
        { method: "POST" }
      );
      expect(clearRes.status).toBe(200);

      const entriesRes = await fetch(`${ctx.baseUrl}/api/clients/${clientId}/cookies/entries`);
      const entries = await entriesRes.json();
      expect(entries).toHaveLength(0);
    } finally {
      ws.close();
    }
  });

  it("offline client: viewer connects and gets empty init for cookies", async () => {
    const link = await ctx.createLink(["cookies"]);
    const ws = await ctx.connectPayloadWs();

    let clientId;
    try {
      const result = await doHandshake(ws, link);
      clientId = result.clientId;
    } finally {
      ws.close();
    }

    // Wait for disconnect to be processed
    await new Promise((r) => setTimeout(r, 100));

    const v = connectCookiesViewer(ctx.wsUrl, clientId);
    await v.ready;
    const raw = await v.firstMsg;
    const msg = JSON.parse(raw);
    expect(msg.type).toBe("init");
    expect(Array.isArray(msg.cookies)).toBe(true);
    v.ws.close();
  });
});
