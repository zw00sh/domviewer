import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { encodeMessage } from "../../shared/codec.js";
import { WebSocket } from "ws";
import { startTestServer, doHandshake, makeBinaryFrame, waitForClose } from "../helpers/setup-server.js";

/**
 * Connect viewer WS with a message collector attached before open fires.
 * Returns { ws, firstMsg: Promise<string>, nextMsg(): Promise<string> }
 */
function connectViewer(wsUrl, clientId, payload = "domviewer") {
  const url = `${wsUrl}/view?id=${clientId}&payload=${payload}`;
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

describe("WS viewer", () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("viewer connects and receives initial JSON snapshot", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);
      const v = connectViewer(ctx.wsUrl, clientId, "domviewer");
      await v.ready;

      const raw = await v.firstMsg;
      const msg = JSON.parse(raw);
      expect(msg.type).toBe("snapshot");
      expect(msg.nodes).toEqual({});
      expect(msg.meta).toEqual({});
      v.ws.close();
    } finally {
      ws.close();
    }
  });

  it("domviewer update pushes to viewer", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);
      const v = connectViewer(ctx.wsUrl, clientId, "domviewer");
      await v.ready;
      await v.firstMsg; // consume initial snapshot

      const snapshot = encodeMessage({
        type: "snapshot",
        nodes: { root: { type: 1, tag: "div", attrs: {}, children: [] } },
        meta: { rootId: "root" },
      });

      const nextPromise = v.nextMsg();
      ws.send(makeBinaryFrame("domviewer", snapshot));
      const raw = await nextPromise;
      const msg = JSON.parse(raw);
      expect(msg.type).toBe("snapshot");
      expect(msg.nodes.root.tag).toBe("div");

      v.ws.close();
    } finally {
      ws.close();
    }
  });

  it("spider viewer receives init with results on connect", async () => {
    const link = await ctx.createLink(["spider"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);

      // Add a spider result first
      ws.send(JSON.stringify({
        type: "payload",
        name: "spider",
        data: { type: "result", url: "https://test.com", status: 200, depth: 0 },
      }));
      await new Promise((r) => setTimeout(r, 100));

      const v = connectViewer(ctx.wsUrl, clientId, "spider");
      await v.ready;
      const raw = await v.firstMsg;
      const msg = JSON.parse(raw);

      expect(msg.type).toBe("init");
      expect(msg.results.length).toBe(1);
      expect(msg.results[0].url).toBe("https://test.com");
      v.ws.close();
    } finally {
      ws.close();
    }
  });

  it("unknown clientId closes WS", async () => {
    const viewer = await ctx.connectViewerWs("nonexistent-id", "domviewer");
    await waitForClose(viewer);
  });

  it("unknown payload closes WS", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);
      const viewer = await ctx.connectViewerWs(clientId, "nonexistent");
      await waitForClose(viewer);
    } finally {
      ws.close();
    }
  });

  it("multiple viewers all receive updates", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const ws = await ctx.connectPayloadWs();

    try {
      const { clientId } = await doHandshake(ws, link);
      const v1 = connectViewer(ctx.wsUrl, clientId, "domviewer");
      const v2 = connectViewer(ctx.wsUrl, clientId, "domviewer");

      await Promise.all([v1.ready, v2.ready]);
      await Promise.all([v1.firstMsg, v2.firstMsg]);

      const snapshot = encodeMessage({
        type: "snapshot",
        nodes: { root: { type: 1, tag: "p", attrs: {}, children: [] } },
        meta: { rootId: "root" },
      });

      const p1 = v1.nextMsg();
      const p2 = v2.nextMsg();

      ws.send(makeBinaryFrame("domviewer", snapshot));

      const [raw1, raw2] = await Promise.all([p1, p2]);
      const msg1 = JSON.parse(raw1);
      const msg2 = JSON.parse(raw2);
      expect(msg1.nodes.root.tag).toBe("p");
      expect(msg2.nodes.root.tag).toBe("p");

      v1.ws.close();
      v2.ws.close();
    } finally {
      ws.close();
    }
  });
});
