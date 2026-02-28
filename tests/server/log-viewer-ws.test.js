import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { startTestServer, doHandshake, createMessageCollector } from "../helpers/setup-server.js";

describe("Log viewer WebSocket", () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    await ctx.close();
  });

  // Helper that connects a log viewer WS and immediately attaches a collector
  // so no messages are missed between open and collector setup.
  function connectLogViewer(clientId = null) {
    const params = clientId
      ? `?id=${clientId}&payload=logs`
      : "?payload=logs";
    const ws = new WebSocket(`${ctx.wsUrl}/view${params}`);
    const collector = createMessageCollector(ws);
    const ready = new Promise((res, rej) => {
      ws.on("open", () => res());
      ws.on("error", rej);
    });
    return { ws, collector, ready };
  }

  it("global log viewer receives init with existing logs", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, link.id);

    // Send a log
    ws.send(JSON.stringify({
      type: "log",
      level: "info",
      source: "loader",
      message: "before viewer",
      timestamp: 1000,
    }));
    await new Promise((r) => setTimeout(r, 100));

    // Connect global log viewer with collector attached before open
    const viewer = connectLogViewer();
    await viewer.ready;

    const initMsg = await viewer.collector.wait((m) => m.type === "init");
    expect(Array.isArray(initMsg.logs)).toBe(true);
    expect(initMsg.logs.some((l) => l.message === "before viewer")).toBe(true);

    viewer.ws.close();
    ws.close();
  });

  it("global log viewer receives live log pushes", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();
    await doHandshake(ws, link.id);

    // Connect global log viewer
    const viewer = connectLogViewer();
    await viewer.ready;

    // Consume init
    await viewer.collector.wait((m) => m.type === "init");

    // Send a new log
    ws.send(JSON.stringify({
      type: "log",
      level: "error",
      source: "spider",
      message: "live push test",
      timestamp: 2000,
    }));

    const logMsg = await viewer.collector.wait((m) => m.type === "log");
    expect(logMsg.entry.message).toBe("live push test");
    expect(logMsg.entry.level).toBe("error");
    expect(logMsg.entry.source).toBe("spider");

    viewer.ws.close();
    ws.close();
  });

  it("per-client log viewer only receives that client's logs", async () => {
    const link = await ctx.createLink(["domviewer"]);

    // Connect two clients
    const ws1 = await ctx.connectPayloadWs();
    const { clientId: clientId1 } = await doHandshake(ws1, link.id);

    const ws2 = await ctx.connectPayloadWs();
    const { clientId: clientId2 } = await doHandshake(ws2, link.id);

    // Connect per-client viewer for client1
    const viewer = connectLogViewer(clientId1);
    await viewer.ready;

    const initMsg = await viewer.collector.wait((m) => m.type === "init");
    // Should only have client1's logs in init
    expect(initMsg.logs.every((l) => l.clientId === clientId1)).toBe(true);

    // Send log from client1
    ws1.send(JSON.stringify({
      type: "log",
      level: "info",
      source: "loader",
      message: "from client1",
      timestamp: 3000,
    }));

    const logMsg = await viewer.collector.wait((m) => m.type === "log");
    expect(logMsg.entry.message).toBe("from client1");

    // Send log from client2 — viewer should NOT receive it
    ws2.send(JSON.stringify({
      type: "log",
      level: "info",
      source: "loader",
      message: "from client2",
      timestamp: 3001,
    }));

    // Wait a bit and ensure no message arrived
    await new Promise((r) => setTimeout(r, 200));

    // Send another from client1 to verify viewer is still working
    ws1.send(JSON.stringify({
      type: "log",
      level: "info",
      source: "loader",
      message: "from client1 again",
      timestamp: 3002,
    }));

    const logMsg2 = await viewer.collector.wait((m) => m.type === "log" && m.entry.timestamp === 3002);
    expect(logMsg2.entry.message).toBe("from client1 again");

    viewer.ws.close();
    ws1.close();
    ws2.close();
  });

  it("per-client log viewer init returns empty for unknown client", async () => {
    const viewer = connectLogViewer("nonexistent-id");
    await viewer.ready;

    const initMsg = await viewer.collector.wait((m) => m.type === "init");
    expect(initMsg.logs).toEqual([]);

    viewer.ws.close();
  });
});
