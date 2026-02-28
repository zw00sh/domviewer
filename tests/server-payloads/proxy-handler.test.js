import { describe, it, expect, vi } from "vitest";
import { encodeMessage } from "../../shared/codec.js";
import * as handler from "../../server/payloads/proxy.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_CLIENT_ID = "test-client-id";
const makeState = () => handler.initState(null, TEST_CLIENT_ID, vi.fn());

/**
 * Create a minimal mock WebSocket that records outgoing messages.
 * @returns {{ ws: object, messages: string[], closeHandlers: Function[] }}
 */
function makeMockWs() {
  const messages = [];
  const messageHandlers = [];
  const closeHandlers = [];
  const ws = {
    readyState: 1,
    send: (data) => messages.push(data),
    on: (event, fn) => {
      if (event === "close") closeHandlers.push(fn);
      if (event === "message") messageHandlers.push(fn);
    },
    /** Helper: simulate an incoming message from the viewer. */
    receive: (data) => messageHandlers.forEach((h) => h(Buffer.from(JSON.stringify(data)))),
    /** Helper: simulate socket close. */
    close: () => closeHandlers.forEach((h) => h()),
  };
  return { ws, messages, closeHandlers };
}

// ─── initState ────────────────────────────────────────────────────────────────

describe("proxy handler — initState", () => {
  it("returns correct shape", () => {
    const state = makeState();
    expect(state.nodes).toBeInstanceOf(Map);
    expect(state.meta).toEqual({});
    expect(state.viewers).toBeInstanceOf(Set);
    expect(state.viewers.size).toBe(0);
    expect(state.sendToClient).toBeNull();
    expect(state.proxyUrl).toBeNull();
  });
});

// ─── onBinary ─────────────────────────────────────────────────────────────────

describe("proxy handler — onBinary", () => {
  it("applies msgpack-encoded snapshot and forwards JSON to viewers", () => {
    const state = makeState();
    const { ws, messages } = makeMockWs();
    handler.onViewerConnect(state, ws);
    // Discard the initial snapshot sent on connect
    messages.length = 0;

    const msg = {
      type: "snapshot",
      nodes: { root: { type: 1, tag: "html", attrs: {}, children: [] } },
      meta: { rootId: "root" },
    };
    handler.onBinary(state, encodeMessage(msg), vi.fn());

    expect(state.nodes.get("root")?.tag).toBe("html");
    expect(state.meta.rootId).toBe("root");

    expect(messages.length).toBe(1);
    const forwarded = JSON.parse(messages[0]);
    expect(forwarded.type).toBe("snapshot");
    expect(forwarded.nodes.root.tag).toBe("html");
  });

  it("applies delta ops correctly", () => {
    const state = makeState();
    const pushToViewers = vi.fn();

    // Seed with a snapshot
    handler.onBinary(state, encodeMessage({
      type: "snapshot",
      nodes: {
        r: { type: 1, tag: "div", attrs: {}, children: ["t1"] },
        t1: { type: 3, text: "hello" },
      },
      meta: { rootId: "r" },
    }), pushToViewers);

    // Apply a text delta
    handler.onBinary(state, encodeMessage({
      type: "delta",
      ops: [{ op: "text", id: "t1", text: "world" }],
    }), pushToViewers);

    expect(state.nodes.get("t1")?.text).toBe("world");
  });

  it("does not throw on corrupt data", () => {
    const state = makeState();
    expect(() =>
      handler.onBinary(state, new Uint8Array([0xff, 0xfe, 0xfd]), vi.fn())
    ).not.toThrow();
  });
});

// ─── onMessage ────────────────────────────────────────────────────────────────

describe("proxy handler — onMessage", () => {
  it("navigated message updates proxyUrl and broadcasts to viewers", () => {
    const state = makeState();
    const { ws, messages } = makeMockWs();
    handler.onViewerConnect(state, ws);
    messages.length = 0;

    handler.onMessage(state, { type: "navigated", url: "https://example.com/page" }, vi.fn());

    expect(state.proxyUrl).toBe("https://example.com/page");
    expect(messages.length).toBe(1);
    const broadcast = JSON.parse(messages[0]);
    expect(broadcast.type).toBe("navigated");
    expect(broadcast.url).toBe("https://example.com/page");
  });

  it("navigated with no viewers does not throw", () => {
    const state = makeState();
    expect(() =>
      handler.onMessage(state, { type: "navigated", url: "https://example.com" }, vi.fn())
    ).not.toThrow();
    expect(state.proxyUrl).toBe("https://example.com");
  });

  it("value-sync message is relayed to all viewers", () => {
    const state = makeState();
    const { ws, messages } = makeMockWs();
    handler.onViewerConnect(state, ws);
    messages.length = 0;

    handler.onMessage(state, { type: "value-sync", nid: "n3", value: "hello" }, vi.fn());

    expect(messages.length).toBe(1);
    const relayed = JSON.parse(messages[0]);
    expect(relayed.type).toBe("value-sync");
    expect(relayed.nid).toBe("n3");
    expect(relayed.value).toBe("hello");
  });

  it("value-sync with no viewers does not throw", () => {
    const state = makeState();
    expect(() =>
      handler.onMessage(state, { type: "value-sync", nid: "n1", value: "x" }, vi.fn())
    ).not.toThrow();
  });

  it("value-sync relays empty string value", () => {
    const state = makeState();
    const { ws, messages } = makeMockWs();
    handler.onViewerConnect(state, ws);
    messages.length = 0;

    handler.onMessage(state, { type: "value-sync", nid: "n4", value: "" }, vi.fn());

    expect(messages.length).toBe(1);
    const relayed = JSON.parse(messages[0]);
    expect(relayed.value).toBe("");
  });

  it("checked-sync message is relayed to all viewers", () => {
    const state = makeState();
    const { ws, messages } = makeMockWs();
    handler.onViewerConnect(state, ws);
    messages.length = 0;

    handler.onMessage(state, { type: "checked-sync", nid: "n5", checked: true }, vi.fn());

    expect(messages.length).toBe(1);
    const relayed = JSON.parse(messages[0]);
    expect(relayed.type).toBe("checked-sync");
    expect(relayed.nid).toBe("n5");
    expect(relayed.checked).toBe(true);
  });

  it("checked-sync relays false (unchecked) state", () => {
    const state = makeState();
    const { ws, messages } = makeMockWs();
    handler.onViewerConnect(state, ws);
    messages.length = 0;

    handler.onMessage(state, { type: "checked-sync", nid: "n6", checked: false }, vi.fn());

    expect(messages.length).toBe(1);
    const relayed = JSON.parse(messages[0]);
    expect(relayed.checked).toBe(false);
  });

  it("checked-sync with no viewers does not throw", () => {
    const state = makeState();
    expect(() =>
      handler.onMessage(state, { type: "checked-sync", nid: "n1", checked: true }, vi.fn())
    ).not.toThrow();
  });

  it("select-sync message is relayed to all viewers", () => {
    const state = makeState();
    const { ws, messages } = makeMockWs();
    handler.onViewerConnect(state, ws);
    messages.length = 0;

    handler.onMessage(
      state,
      { type: "select-sync", nid: "n7", selectedIndex: 2, value: "option-c" },
      vi.fn()
    );

    expect(messages.length).toBe(1);
    const relayed = JSON.parse(messages[0]);
    expect(relayed.type).toBe("select-sync");
    expect(relayed.nid).toBe("n7");
    expect(relayed.selectedIndex).toBe(2);
    expect(relayed.value).toBe("option-c");
  });

  it("select-sync with no viewers does not throw", () => {
    const state = makeState();
    expect(() =>
      handler.onMessage(
        state,
        { type: "select-sync", nid: "n1", selectedIndex: 0, value: "" },
        vi.fn()
      )
    ).not.toThrow();
  });

  it("scroll-sync message is relayed to all viewers", () => {
    const state = makeState();
    const { ws, messages } = makeMockWs();
    handler.onViewerConnect(state, ws);
    messages.length = 0;

    handler.onMessage(state, { type: "scroll-sync", scrollX: 120, scrollY: 350 }, vi.fn());

    expect(messages.length).toBe(1);
    const relayed = JSON.parse(messages[0]);
    expect(relayed.type).toBe("scroll-sync");
    expect(relayed.scrollX).toBe(120);
    expect(relayed.scrollY).toBe(350);
  });

  it("scroll-sync with no viewers does not throw", () => {
    const state = makeState();
    expect(() =>
      handler.onMessage(state, { type: "scroll-sync", scrollX: 0, scrollY: 0 }, vi.fn())
    ).not.toThrow();
  });
});

// ─── onViewerConnect ──────────────────────────────────────────────────────────

describe("proxy handler — onViewerConnect", () => {
  it("sends initial snapshot on connect", () => {
    const state = makeState();
    const { ws, messages } = makeMockWs();

    handler.onViewerConnect(state, ws);

    expect(state.viewers.has(ws)).toBe(true);
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const snapshot = JSON.parse(messages[0]);
    expect(snapshot.type).toBe("snapshot");
    expect(snapshot.nodes).toEqual({});
    expect(snapshot.meta).toEqual({});
  });

  it("sends navigated message if proxyUrl is set", () => {
    const state = makeState();
    state.proxyUrl = "https://example.com";
    const { ws, messages } = makeMockWs();

    handler.onViewerConnect(state, ws);

    // Should receive snapshot + navigated
    const types = messages.map((m) => JSON.parse(m).type);
    expect(types).toContain("navigated");
    const nav = JSON.parse(messages.find((m) => JSON.parse(m).type === "navigated"));
    expect(nav.url).toBe("https://example.com");
  });

  it("forwards event messages from viewer to sendToClient", () => {
    const state = makeState();
    const sendToClient = vi.fn();
    state.sendToClient = sendToClient;

    const { ws } = makeMockWs();
    handler.onViewerConnect(state, ws);

    ws.receive({ type: "event", data: { nid: "n5", event: "click" } });

    expect(sendToClient).toHaveBeenCalledWith({ type: "event", nid: "n5", event: "click" });
  });

  it("forwards navigate messages from viewer to sendToClient", () => {
    const state = makeState();
    const sendToClient = vi.fn();
    state.sendToClient = sendToClient;

    const { ws } = makeMockWs();
    handler.onViewerConnect(state, ws);

    ws.receive({ type: "navigate", url: "https://example.com/other" });

    expect(sendToClient).toHaveBeenCalledWith({
      type: "navigate",
      url: "https://example.com/other",
    });
  });

  it("drops viewer events when sendToClient is null (client disconnected)", () => {
    const state = makeState();
    state.sendToClient = null;

    const { ws } = makeMockWs();
    handler.onViewerConnect(state, ws);

    // Should not throw
    expect(() =>
      ws.receive({ type: "event", data: { nid: "n1", event: "click" } })
    ).not.toThrow();
  });

  it("removes ws from viewers on close", () => {
    const state = makeState();
    const { ws } = makeMockWs();
    handler.onViewerConnect(state, ws);
    expect(state.viewers.has(ws)).toBe(true);
    ws.close();
    expect(state.viewers.has(ws)).toBe(false);
  });

  it("forwards viewport message from viewer to sendToClient", () => {
    const state = makeState();
    const sendToClient = vi.fn();
    state.sendToClient = sendToClient;

    const { ws } = makeMockWs();
    handler.onViewerConnect(state, ws);

    ws.receive({ type: "viewport", width: 800, height: 600 });

    expect(sendToClient).toHaveBeenCalledWith({
      type: "viewport",
      width: 800,
      height: 600,
    });
  });

  it("event message with coordinate data is forwarded intact", () => {
    const state = makeState();
    const sendToClient = vi.fn();
    state.sendToClient = sendToClient;

    const { ws } = makeMockWs();
    handler.onViewerConnect(state, ws);

    ws.receive({
      type: "event",
      data: { nid: "n9", event: "click", clientX: 42, clientY: 17, offsetX: 10, offsetY: 5 },
    });

    expect(sendToClient).toHaveBeenCalledWith({
      type: "event",
      nid: "n9",
      event: "click",
      clientX: 42,
      clientY: 17,
      offsetX: 10,
      offsetY: 5,
    });
  });
});

// ─── onConnect ────────────────────────────────────────────────────────────────

describe("proxy handler — onConnect", () => {
  it("stores sendToClient in state", () => {
    const state = makeState();
    const sendToClient = vi.fn();
    handler.onConnect(state, { isReconnect: false, sendToClient });
    expect(state.sendToClient).toBe(sendToClient);
  });

  it("requests full sync on reconnect", () => {
    const state = makeState();
    const sendToClient = vi.fn();
    handler.onConnect(state, { isReconnect: true, sendToClient });
    expect(sendToClient).toHaveBeenCalledWith({ type: "request-sync" });
  });

  it("does not request sync on initial connect", () => {
    const state = makeState();
    const sendToClient = vi.fn();
    handler.onConnect(state, { isReconnect: false, sendToClient });
    expect(sendToClient).not.toHaveBeenCalled();
  });
});

// ─── event relay (focus / blur / incremental input) ───────────────────────────
//
// The server spreads msg.data into the client message, so new event types are
// relayed without any server-side changes.  These tests document the expected
// protocol and guard against regressions.

describe("proxy handler — event relay (focus / blur / input)", () => {
  it("relays focus event from viewer to client", () => {
    const state = makeState();
    const sendToClient = vi.fn();
    state.sendToClient = sendToClient;

    const { ws } = makeMockWs();
    handler.onViewerConnect(state, ws);

    ws.receive({ type: "event", data: { nid: "n1", event: "focus" } });

    expect(sendToClient).toHaveBeenCalledWith({ type: "event", nid: "n1", event: "focus" });
  });

  it("relays blur event from viewer to client", () => {
    const state = makeState();
    const sendToClient = vi.fn();
    state.sendToClient = sendToClient;

    const { ws } = makeMockWs();
    handler.onViewerConnect(state, ws);

    ws.receive({ type: "event", data: { nid: "n1", event: "blur" } });

    expect(sendToClient).toHaveBeenCalledWith({ type: "event", nid: "n1", event: "blur" });
  });

  it("relays insertText input event from viewer to client", () => {
    const state = makeState();
    const sendToClient = vi.fn();
    state.sendToClient = sendToClient;

    const { ws } = makeMockWs();
    handler.onViewerConnect(state, ws);

    ws.receive({
      type: "event",
      data: { nid: "n2", event: "input", data: "a", inputType: "insertText" },
    });

    expect(sendToClient).toHaveBeenCalledWith({
      type: "event",
      nid: "n2",
      event: "input",
      data: "a",
      inputType: "insertText",
    });
  });

  it("relays deleteContentBackward input event from viewer to client", () => {
    const state = makeState();
    const sendToClient = vi.fn();
    state.sendToClient = sendToClient;

    const { ws } = makeMockWs();
    handler.onViewerConnect(state, ws);

    ws.receive({
      type: "event",
      data: { nid: "n2", event: "input", inputType: "deleteContentBackward" },
    });

    expect(sendToClient).toHaveBeenCalledWith({
      type: "event",
      nid: "n2",
      event: "input",
      inputType: "deleteContentBackward",
    });
  });

  it("drops relay when sendToClient is null", () => {
    const state = makeState();
    state.sendToClient = null;

    const { ws } = makeMockWs();
    handler.onViewerConnect(state, ws);

    expect(() =>
      ws.receive({ type: "event", data: { nid: "n1", event: "focus" } })
    ).not.toThrow();
  });

  it("relays mouseover event from viewer to client", () => {
    const state = makeState();
    const sendToClient = vi.fn();
    state.sendToClient = sendToClient;

    const { ws } = makeMockWs();
    handler.onViewerConnect(state, ws);

    ws.receive({ type: "event", data: { nid: "n7", event: "mouseover" } });

    expect(sendToClient).toHaveBeenCalledWith({ type: "event", nid: "n7", event: "mouseover" });
  });

  it("relays mouseout event from viewer to client", () => {
    const state = makeState();
    const sendToClient = vi.fn();
    state.sendToClient = sendToClient;

    const { ws } = makeMockWs();
    handler.onViewerConnect(state, ws);

    ws.receive({ type: "event", data: { nid: "n8", event: "mouseout" } });

    expect(sendToClient).toHaveBeenCalledWith({ type: "event", nid: "n8", event: "mouseout" });
  });
});

// ─── New relay message types (Phases 1, 3, 5) ──────────────────────────────────

describe("proxy handler — element-scroll-sync relay (Phase 3)", () => {
  it("relays element-scroll-sync to all viewers", () => {
    const state = makeState();
    const { ws, messages } = makeMockWs();
    handler.onViewerConnect(state, ws);
    messages.length = 0;

    handler.onMessage(state, { type: "element-scroll-sync", nid: "n10", scrollTop: 300, scrollLeft: 50 }, vi.fn());

    expect(messages.length).toBe(1);
    const relayed = JSON.parse(messages[0]);
    expect(relayed.type).toBe("element-scroll-sync");
    expect(relayed.nid).toBe("n10");
    expect(relayed.scrollTop).toBe(300);
    expect(relayed.scrollLeft).toBe(50);
  });

  it("element-scroll-sync with no viewers does not throw", () => {
    const state = makeState();
    expect(() =>
      handler.onMessage(state, { type: "element-scroll-sync", nid: "n1", scrollTop: 0, scrollLeft: 0 }, vi.fn())
    ).not.toThrow();
  });
});

describe("proxy handler — selection-sync relay (Phase 1)", () => {
  it("relays selection-sync to all viewers", () => {
    const state = makeState();
    const { ws, messages } = makeMockWs();
    handler.onViewerConnect(state, ws);
    messages.length = 0;

    handler.onMessage(state, { type: "selection-sync", nid: "n11", selectionStart: 2, selectionEnd: 5 }, vi.fn());

    expect(messages.length).toBe(1);
    const relayed = JSON.parse(messages[0]);
    expect(relayed.type).toBe("selection-sync");
    expect(relayed.nid).toBe("n11");
    expect(relayed.selectionStart).toBe(2);
    expect(relayed.selectionEnd).toBe(5);
  });

  it("selection-sync with collapsed cursor (start === end) is relayed", () => {
    const state = makeState();
    const { ws, messages } = makeMockWs();
    handler.onViewerConnect(state, ws);
    messages.length = 0;

    handler.onMessage(state, { type: "selection-sync", nid: "n12", selectionStart: 3, selectionEnd: 3 }, vi.fn());

    const relayed = JSON.parse(messages[0]);
    expect(relayed.selectionStart).toBe(3);
    expect(relayed.selectionEnd).toBe(3);
  });

  it("selection-sync with no viewers does not throw", () => {
    const state = makeState();
    expect(() =>
      handler.onMessage(state, { type: "selection-sync", nid: "n1", selectionStart: 0, selectionEnd: 0 }, vi.fn())
    ).not.toThrow();
  });
});

describe("proxy handler — focus-sync relay (Phase 5)", () => {
  it("relays focus-sync to all viewers", () => {
    const state = makeState();
    const { ws, messages } = makeMockWs();
    handler.onViewerConnect(state, ws);
    messages.length = 0;

    handler.onMessage(state, { type: "focus-sync", nid: "n13" }, vi.fn());

    expect(messages.length).toBe(1);
    const relayed = JSON.parse(messages[0]);
    expect(relayed.type).toBe("focus-sync");
    expect(relayed.nid).toBe("n13");
  });

  it("focus-sync with no viewers does not throw", () => {
    const state = makeState();
    expect(() =>
      handler.onMessage(state, { type: "focus-sync", nid: "n1" }, vi.fn())
    ).not.toThrow();
  });

  it("focus-sync with multiple viewers broadcasts to all", () => {
    const state = makeState();
    const { ws: ws1, messages: msgs1 } = makeMockWs();
    const { ws: ws2, messages: msgs2 } = makeMockWs();
    handler.onViewerConnect(state, ws1);
    handler.onViewerConnect(state, ws2);
    msgs1.length = 0;
    msgs2.length = 0;

    handler.onMessage(state, { type: "focus-sync", nid: "n14" }, vi.fn());

    expect(msgs1.length).toBe(1);
    expect(msgs2.length).toBe(1);
    expect(JSON.parse(msgs1[0]).nid).toBe("n14");
    expect(JSON.parse(msgs2[0]).nid).toBe("n14");
  });
});

// ─── onDisconnect ─────────────────────────────────────────────────────────────

describe("proxy handler — onDisconnect", () => {
  it("nulls sendToClient and broadcasts disconnected to viewers", () => {
    const state = makeState();
    state.sendToClient = vi.fn();

    const { ws, messages } = makeMockWs();
    handler.onViewerConnect(state, ws);
    messages.length = 0;

    handler.onDisconnect(state);

    expect(state.sendToClient).toBeNull();
    expect(messages.length).toBe(1);
    expect(JSON.parse(messages[0]).type).toBe("disconnected");
  });

  it("does not throw when there are no viewers", () => {
    const state = makeState();
    state.sendToClient = vi.fn();
    expect(() => handler.onDisconnect(state)).not.toThrow();
    expect(state.sendToClient).toBeNull();
  });
});
