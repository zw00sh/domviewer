/**
 * Integration tests for the payload handler lifecycle hooks and offline viewer support.
 *
 * Items covered:
 *   Item 5 — onConnect + request-sync: server requests a DOM snapshot on reconnect
 *   Item 6 — onDisconnect: handlers notify viewers when the client stream ends
 *   Item 7 — Viewer WS for disconnected clients (spider results are DB-backed)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import {
  startTestServer,
  doHandshake,
  createMessageCollector,
  waitForClose,
} from "../helpers/setup-server.js";

describe("Payload lifecycle hooks", () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    await ctx.close();
  });

  // ---------- Item 5: onConnect / request-sync ----------

  it("reconnecting domviewer client receives request-sync message", async () => {
    const link = await ctx.createLink(["domviewer"]);

    // First connect
    const ws1 = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws1, link);
    ws1.close();
    await new Promise((r) => setTimeout(r, 100));

    // Reconnect with same clientId
    const ws2 = await ctx.connectPayloadWs();
    const collector = createMessageCollector(ws2);

    ws2.send(JSON.stringify({ type: "init", clientId, linkId: link.id, reconnect: true, origin: "http://test-origin.example.com" }));

    // Wait for the load message first, then the request-sync
    await collector.wait((m) => m.type === "load" && m.name === "domviewer");

    const syncMsg = await collector.wait(
      (m) => m.type === "payload" && m.name === "domviewer" && m.data?.type === "request-sync"
    );
    expect(syncMsg.data.type).toBe("request-sync");

    ws2.close();
  });

  it("initial domviewer connect does not receive request-sync", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { collector } = await doHandshake(ws, link);

      // Wait briefly — no request-sync should arrive on initial connect
      let receivedSync = false;
      const syncPromise = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 400);
        collector.wait((m) => m.type === "payload" && m.data?.type === "request-sync")
          .then(() => { receivedSync = true; clearTimeout(timer); resolve(true); })
          .catch(() => resolve(false));
      });

      await syncPromise;
      expect(receivedSync).toBe(false);
    } finally {
      ws.close();
    }
  });

  // ---------- Item 6: onDisconnect ----------

  it("spider viewer receives disconnected event when client WS closes", async () => {
    const link = await ctx.createLink(["spider"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);

      // Connect a spider viewer
      const viewerWs = new WebSocket(`${ctx.wsUrl}/view?id=${clientId}&payload=spider`);
      const viewerCollector = createMessageCollector(viewerWs);
      await new Promise((res, rej) => {
        viewerWs.on("open", res);
        viewerWs.on("error", rej);
      });

      // Consume the init message
      await viewerCollector.wait((m) => m.type === "init");

      // Set up wait for disconnected BEFORE closing the payload WS
      const disconnectPromise = viewerCollector.wait((m) => m.type === "disconnected");

      // Disconnect the payload client
      ws.close();
      await new Promise((r) => setTimeout(r, 100));

      const disconnectMsg = await disconnectPromise;
      expect(disconnectMsg.type).toBe("disconnected");

      viewerWs.close();
    } finally {
      // ws already closed above; this is a no-op if already closed
      try { ws.close(); } catch (_) {}
    }
  });

  // ---------- Item 7: Viewer WS for disconnected clients ----------

  it("offline spider client viewer receives DB-backed results", async () => {
    const link = await ctx.createLink(["spider"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, link);

    // Send a spider result while connected
    ws.send(JSON.stringify({
      type: "payload",
      name: "spider",
      data: { type: "result", url: "https://offline-test.com/page", status: 200, depth: 0 },
    }));
    await new Promise((r) => setTimeout(r, 100));

    // Disconnect the client
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(ctx.clients.get(clientId).connected).toBe(false);

    // Connect a viewer for the offline client
    const viewerWs = new WebSocket(`${ctx.wsUrl}/view?id=${clientId}&payload=spider`);
    const collector = createMessageCollector(viewerWs);
    await new Promise((res, rej) => {
      viewerWs.on("open", res);
      viewerWs.on("error", rej);
    });

    const initMsg = await collector.wait((m) => m.type === "init");
    expect(initMsg.results.length).toBe(1);
    expect(initMsg.results[0].url).toBe("https://offline-test.com/page");

    viewerWs.close();
  });

  it("offline domviewer client viewer receives initial empty state", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, link);

    // Disconnect
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(ctx.clients.get(clientId).connected).toBe(false);

    // Connect a viewer — should receive the "No DOM captured yet" placeholder, not a close
    const viewerWs = new WebSocket(`${ctx.wsUrl}/view?id=${clientId}&payload=domviewer`);
    const firstMsg = await new Promise((resolve, reject) => {
      viewerWs.once("message", (data) => resolve(data.toString()));
      viewerWs.on("error", reject);
      viewerWs.on("close", () => reject(new Error("Viewer WS closed before message")));
    });

    // Viewer now receives a JSON snapshot instead of rendered HTML
    const parsed = JSON.parse(firstMsg);
    expect(parsed.type).toBe("snapshot");
    expect(parsed.nodes).toEqual({});
    expect(parsed.meta).toEqual({});
    viewerWs.close();
  });

  it("viewer for offline client with payload not in client's list is rejected", async () => {
    // Create a domviewer-only link (no spider)
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, link);

    // Disconnect
    ws.close();
    await new Promise((r) => setTimeout(r, 100));

    // Try to connect a spider viewer — should be rejected
    const viewerWs = new WebSocket(`${ctx.wsUrl}/view?id=${clientId}&payload=spider`);
    await waitForClose(viewerWs);
  });

  it("viewer for completely unknown clientId is rejected", async () => {
    const viewerWs = new WebSocket(`${ctx.wsUrl}/view?id=totally-unknown-uuid&payload=spider`);
    await waitForClose(viewerWs);
  });
});
