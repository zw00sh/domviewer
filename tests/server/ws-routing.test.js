import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { encodeMessage } from "../../shared/codec.js";
import { startTestServer, doHandshake, makeBinaryFrame } from "../helpers/setup-server.js";

describe("WS message routing", () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("binary frame with domviewer prefix routes to onBinary handler", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);
      const entry = ctx.clients.get(clientId);
      const nodesBefore = entry.activePayloads.domviewer.nodes.size;

      const snapshot = encodeMessage({
        type: "snapshot",
        nodes: { test: { type: 1, tag: "span", attrs: {}, children: [] } },
        meta: { rootId: "test" },
      });
      const frame = makeBinaryFrame("domviewer", snapshot);

      ws.send(frame);
      await new Promise((r) => setTimeout(r, 200));

      const nodesAfter = entry.activePayloads.domviewer.nodes.size;
      expect(nodesAfter).toBeGreaterThan(nodesBefore);
    } finally {
      ws.close();
    }
  });

  it("text payload message routes to onMessage handler", async () => {
    const link = await ctx.createLink(["spider"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);
      const entry = ctx.clients.get(clientId);

      ws.send(JSON.stringify({
        type: "payload",
        name: "spider",
        data: { type: "result", url: "https://test.com", status: 200, depth: 0 },
      }));

      await new Promise((r) => setTimeout(r, 200));
      expect(entry.activePayloads.spider.results.length).toBe(1);
      expect(entry.activePayloads.spider.results[0].url).toBe("https://test.com");
    } finally {
      ws.close();
    }
  });

  it("binary before init is dropped", async () => {
    const ws = await ctx.connectPayloadWs();

    try {
      const frame = makeBinaryFrame("domviewer", new Uint8Array([1, 2, 3]));
      ws.send(frame);
      await new Promise((r) => setTimeout(r, 100));
    } finally {
      ws.close();
    }
  });

  it("malformed binary frame (bad nameLen) is dropped", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();

    try {
      await doHandshake(ws, link);
      ws.send(new Uint8Array([255, 1, 2]));
      await new Promise((r) => setTimeout(r, 100));
    } finally {
      ws.close();
    }
  });

  it("unknown payload name is ignored", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();

    try {
      await doHandshake(ws, link);
      ws.send(JSON.stringify({ type: "payload", name: "nonexistent", data: {} }));
      await new Promise((r) => setTimeout(r, 100));
    } finally {
      ws.close();
    }
  });

  it("malformed JSON text is ignored", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();

    try {
      await doHandshake(ws, link);
      ws.send("this is not json{{{");
      await new Promise((r) => setTimeout(r, 100));
    } finally {
      ws.close();
    }
  });
});
