import { describe, it, expect, vi } from "vitest";
import * as handler from "../../server/payloads/cookies.js";

/** Minimal in-memory mock of the DB layer for cookies handler unit tests. */
function makeMockDb() {
  const entryStore = [];
  return {
    insertCookieEntry(clientId, name, value, removed, timestamp) {
      entryStore.push({ clientId, name, value, removed, timestamp });
    },
    getCookieEntries(_clientId) {
      return entryStore.slice();
    },
    clearCookieEntries(_clientId) {
      entryStore.splice(0);
    },
    _entryStore: entryStore,
  };
}

describe("cookies handler", () => {
  it("initState returns cookies getter and viewers set", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    expect(state.cookies).toEqual([]);
    expect(state.viewers).toBeInstanceOf(Set);
  });

  it("cookies getter is DB-backed and reflects insertions", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    expect(state.cookies.length).toBe(0);
    db.insertCookieEntry("client-1", "session", "abc123", false, Date.now());
    expect(state.cookies.length).toBe(1);
    expect(state.cookies[0].name).toBe("session");
  });

  it("onMessage with cookies type stores entries and broadcasts to viewers", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    const ws = { readyState: 1, send: vi.fn() };
    state.viewers.add(ws);
    const pushToViewers = vi.fn();

    handler.onMessage(state, {
      type: "cookies",
      cookies: [
        { name: "session", value: "abc123", timestamp: 1000 },
        { name: "theme", value: "dark", timestamp: 1001 },
      ],
    }, pushToViewers);

    expect(db._entryStore).toHaveLength(2);
    expect(db._entryStore[0].name).toBe("session");
    expect(db._entryStore[1].name).toBe("theme");

    expect(ws.send).toHaveBeenCalledOnce();
    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg.type).toBe("cookies");
    expect(msg.cookies).toHaveLength(2);
  });

  it("onMessage stores removed cookies correctly", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    const pushToViewers = vi.fn();

    handler.onMessage(state, {
      type: "cookies",
      cookies: [
        { name: "session", value: null, removed: true, timestamp: 2000 },
      ],
    }, pushToViewers);

    expect(db._entryStore).toHaveLength(1);
    expect(db._entryStore[0].removed).toBe(true);
    expect(db._entryStore[0].value).toBeNull();
  });

  it("onMessage ignores empty cookies array", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    const pushToViewers = vi.fn();

    handler.onMessage(state, { type: "cookies", cookies: [] }, pushToViewers);
    expect(db._entryStore).toHaveLength(0);
    expect(pushToViewers).not.toHaveBeenCalled();
  });

  it("onMessage ignores unknown message types", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    const pushToViewers = vi.fn();

    handler.onMessage(state, { type: "unknown", cookies: [] }, pushToViewers);
    expect(db._entryStore).toHaveLength(0);
    expect(pushToViewers).not.toHaveBeenCalled();
  });

  it("onViewerConnect sends init with all current cookies", () => {
    const db = makeMockDb();
    db.insertCookieEntry("client-1", "token", "xyz", false, Date.now());
    const state = handler.initState(db, "client-1");
    const ws = { readyState: 1, send: vi.fn(), on: vi.fn() };

    handler.onViewerConnect(state, ws);

    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg.type).toBe("init");
    expect(msg.cookies).toHaveLength(1);
    expect(msg.cookies[0].name).toBe("token");
    expect(state.viewers.has(ws)).toBe(true);
  });

  it("onViewerConnect handles clear message from viewer", () => {
    const db = makeMockDb();
    db.insertCookieEntry("client-1", "session", "abc", false, Date.now());
    const state = handler.initState(db, "client-1");

    let messageHandler;
    const ws = {
      readyState: 1,
      send: vi.fn(),
      on: vi.fn((event, fn) => {
        if (event === "message") messageHandler = fn;
      }),
    };
    const ws2 = { readyState: 1, send: vi.fn(), on: vi.fn() };

    handler.onViewerConnect(state, ws);
    state.viewers.add(ws2);

    // Simulate viewer sending a clear command
    messageHandler(JSON.stringify({ type: "clear" }));

    expect(db._entryStore).toHaveLength(0);
    // Both viewers should receive "cleared"
    expect(ws.send).toHaveBeenCalledTimes(2); // init + cleared
    const cleared = JSON.parse(ws.send.mock.calls[1][0]);
    expect(cleared.type).toBe("cleared");
  });

  it("onViewerConnect removes ws from viewers on close", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    const handlers = {};
    const ws = {
      readyState: 1,
      send: vi.fn(),
      on: vi.fn((event, fn) => { handlers[event] = fn; }),
    };

    handler.onViewerConnect(state, ws);
    expect(state.viewers.has(ws)).toBe(true);

    handlers.close();
    expect(state.viewers.has(ws)).toBe(false);
  });

  it("pushToAllViewers broadcasts all cookies", () => {
    const db = makeMockDb();
    db.insertCookieEntry("client-1", "session", "abc", false, Date.now());
    const state = handler.initState(db, "client-1");
    const ws = { readyState: 1, send: vi.fn() };
    state.viewers.add(ws);

    handler.pushToAllViewers(state);

    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg.type).toBe("cookies");
    expect(msg.cookies).toHaveLength(1);
  });

  it("pushToAllViewers is no-op when no viewers", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    // Should not throw
    expect(() => handler.pushToAllViewers(state)).not.toThrow();
  });

  it("onDisconnect notifies viewers", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    const ws = { readyState: 1, send: vi.fn() };
    state.viewers.add(ws);

    handler.onDisconnect(state);

    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg.type).toBe("disconnected");
  });

  it("onDisconnect is no-op when no viewers", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    expect(() => handler.onDisconnect(state)).not.toThrow();
  });
});
