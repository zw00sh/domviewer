import { describe, it, expect, vi } from "vitest";
import { encodeMessage } from "../../shared/codec.js";
import * as handler from "../../server/payloads/domviewer.js";

const TEST_CLIENT_ID = "test-client-id";
const makeState = () => handler.initState(null, TEST_CLIENT_ID, vi.fn());

describe("domviewer handler", () => {
  it("initState returns nodes map, meta, and viewers", () => {
    const state = makeState();
    expect(state.nodes).toBeInstanceOf(Map);
    expect(state.meta).toEqual({});
    expect(state.viewers).toBeInstanceOf(Set);
    expect(state.viewers.size).toBe(0);
  });

  it("onBinary applies snapshot and forwards to viewers", () => {
    const state = makeState();
    const pushToViewers = vi.fn();

    const msg = {
      type: "snapshot",
      nodes: { root: { type: 1, tag: "div", attrs: {}, children: [] } },
      meta: { rootId: "root" },
    };
    const data = encodeMessage(msg);

    handler.onBinary(state, data, pushToViewers);
    expect(state.nodes.get("root")).toBeTruthy();
    expect(state.nodes.get("root").tag).toBe("div");
    expect(state.meta.rootId).toBe("root");
  });

  it("onBinary applies delta ops", () => {
    const state = makeState();
    const pushToViewers = vi.fn();

    // Start with a snapshot
    handler.onBinary(state, encodeMessage({
      type: "snapshot",
      nodes: { r: { type: 1, tag: "div", attrs: {}, children: ["t1"] }, t1: { type: 3, text: "hello" } },
      meta: { rootId: "r" },
    }), pushToViewers);

    // Apply a text delta
    handler.onBinary(state, encodeMessage({
      type: "delta",
      ops: [{ op: "text", id: "t1", text: "world" }],
    }), pushToViewers);

    expect(state.nodes.get("t1").text).toBe("world");
  });

  it("onBinary with corrupt data does not throw", () => {
    const state = makeState();
    const pushToViewers = vi.fn();
    expect(() => handler.onBinary(state, new Uint8Array([0xff, 0xff]), pushToViewers)).not.toThrow();
  });

  it("onViewerConnect adds ws and sends initial JSON snapshot", () => {
    const state = makeState();
    const messages = [];
    const ws = {
      readyState: 1,
      send: (data) => messages.push(data),
      on: vi.fn(),
    };

    handler.onViewerConnect(state, ws);
    expect(state.viewers.has(ws)).toBe(true);
    expect(messages.length).toBe(1);
    const parsed = JSON.parse(messages[0]);
    expect(parsed.type).toBe("snapshot");
    expect(parsed.nodes).toEqual({});
    expect(parsed.meta).toEqual({});
    expect(ws.on).toHaveBeenCalledWith("close", expect.any(Function));
  });

  it("onViewerConnect sends populated snapshot when state has data", () => {
    const state = makeState();
    state.nodes.set("r", { type: 1, tag: "div", attrs: {}, children: [] });
    state.meta.rootId = "r";

    const messages = [];
    const ws = {
      readyState: 1,
      send: (data) => messages.push(data),
      on: vi.fn(),
    };

    handler.onViewerConnect(state, ws);
    const parsed = JSON.parse(messages[0]);
    expect(parsed.type).toBe("snapshot");
    expect(parsed.nodes.r.tag).toBe("div");
    expect(parsed.meta.rootId).toBe("r");
  });

  it("onViewerConnect removes ws on close", () => {
    const state = makeState();
    let closeHandler;
    const ws = {
      readyState: 1,
      send: vi.fn(),
      on: (event, fn) => { if (event === "close") closeHandler = fn; },
    };

    handler.onViewerConnect(state, ws);
    expect(state.viewers.has(ws)).toBe(true);
    closeHandler();
    expect(state.viewers.has(ws)).toBe(false);
  });

  it("pushToAllViewers fans out to open connections and skips closed", () => {
    const state = makeState();
    const openWs = { readyState: 1, send: vi.fn() };
    const closedWs = { readyState: 3, send: vi.fn() };
    state.viewers.add(openWs);
    state.viewers.add(closedWs);

    handler.pushToAllViewers(state);
    expect(openWs.send).toHaveBeenCalled();
    expect(closedWs.send).not.toHaveBeenCalled();

    // Verify the message is a JSON snapshot
    const parsed = JSON.parse(openWs.send.mock.calls[0][0]);
    expect(parsed.type).toBe("snapshot");
  });

  it("onConnect sends request-sync on reconnect", () => {
    const state = makeState();
    const sendToClient = vi.fn();

    handler.onConnect(state, { isReconnect: true, sendToClient });
    expect(sendToClient).toHaveBeenCalledWith({ type: "request-sync" });
  });

  it("onConnect does not send request-sync on initial connect", () => {
    const state = makeState();
    const sendToClient = vi.fn();

    handler.onConnect(state, { isReconnect: false, sendToClient });
    expect(sendToClient).not.toHaveBeenCalled();
  });
});
