import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, doHandshake } from "../helpers/setup-server.js";

describe("Log messages", () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("stores client log in per-client and global logs", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, link.id);

    ws.send(JSON.stringify({
      type: "log",
      level: "info",
      source: "loader",
      message: "test log message",
      timestamp: 1000,
    }));

    // Wait for message to be processed
    await new Promise((r) => setTimeout(r, 100));

    const client = ctx.clients.get(clientId);
    const clientLog = client.logs.find((l) => l.message === "test log message");
    expect(clientLog).toBeTruthy();
    expect(clientLog.level).toBe("info");
    expect(clientLog.source).toBe("loader");
    expect(clientLog.clientId).toBe(clientId);

    const globalLog = ctx.globalLogs.find((l) => l.message === "test log message");
    expect(globalLog).toBeTruthy();

    ws.close();
  });

  it("server generates connect log entry", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, link.id);

    const client = ctx.clients.get(clientId);
    const connectLog = client.logs.find((l) => l.message.includes("Client connected"));
    expect(connectLog).toBeTruthy();
    expect(connectLog.source).toBe("server");
    expect(connectLog.level).toBe("info");

    ws.close();
  });

  it("server generates disconnect log entry", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, link.id);

    ws.close();
    await new Promise((r) => setTimeout(r, 100));

    const client = ctx.clients.get(clientId);
    const disconnectLog = client.logs.find((l) => l.message === "Client disconnected");
    expect(disconnectLog).toBeTruthy();
    expect(disconnectLog.source).toBe("server");
    expect(disconnectLog.level).toBe("warn");
  });

  it("sanitizes invalid log level to info", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, link.id);

    ws.send(JSON.stringify({
      type: "log",
      level: "INVALID",
      source: "loader",
      message: "bad level",
      timestamp: 2000,
    }));

    await new Promise((r) => setTimeout(r, 100));

    const client = ctx.clients.get(clientId);
    const log = client.logs.find((l) => l.message === "bad level");
    expect(log.level).toBe("info");

    ws.close();
  });

  it("truncates long messages", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, link.id);

    const longMessage = "x".repeat(1000);
    ws.send(JSON.stringify({
      type: "log",
      level: "info",
      source: "loader",
      message: longMessage,
      timestamp: 3000,
    }));

    await new Promise((r) => setTimeout(r, 100));

    const client = ctx.clients.get(clientId);
    const log = client.logs.find((l) => l.timestamp === 3000);
    expect(log.message.length).toBe(500);

    ws.close();
  });

  it("caps per-client logs at 200", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, link.id);

    // Send 210 logs (plus server-generated connect log already there)
    for (let i = 0; i < 210; i++) {
      ws.send(JSON.stringify({
        type: "log",
        level: "info",
        source: "loader",
        message: `msg-${i}`,
        timestamp: 4000 + i,
      }));
    }

    await new Promise((r) => setTimeout(r, 300));

    const client = ctx.clients.get(clientId);
    expect(client.logs.length).toBe(200);

    ws.close();
  });

  it("REST GET /api/clients/:id/logs returns logs", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, link.id);

    ws.send(JSON.stringify({
      type: "log",
      level: "error",
      source: "domviewer",
      message: "rest test",
      timestamp: 5000,
    }));

    await new Promise((r) => setTimeout(r, 100));

    const res = await fetch(`${ctx.baseUrl}/api/clients/${clientId}/logs`);
    const logs = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(logs)).toBe(true);
    expect(logs.some((l) => l.message === "rest test")).toBe(true);

    ws.close();
  });

  it("REST GET /api/clients/:id/logs returns 404 for unknown client", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/clients/nonexistent/logs`);
    expect(res.status).toBe(404);
  });

  it("REST GET /api/logs returns global logs", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/logs`);
    const logs = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(logs)).toBe(true);
  });
});
