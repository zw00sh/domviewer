import { describe, it, expect, vi } from "vitest";
import * as handler from "../../server/payloads/spider.js";

/** Minimal in-memory mock of the DB layer for spider handler unit tests. */
function makeMockDb() {
  const resultStore = [];
  const contentStore = [];
  return {
    insertSpiderResult(_clientId, url, status, depth, discoveredAt, contentType = '', size = 0) {
      resultStore.push({ url, status, depth, discoveredAt, contentType, size });
    },
    getSpiderResults(_clientId) {
      return resultStore.slice();
    },
    insertSpiderContent(clientId, url, contentType, content, size, fetchedAt) {
      contentStore.push({ clientId, url, contentType, content, size, fetchedAt });
    },
    getSpiderContentUrls(_clientId) {
      return [...new Set(contentStore.map((r) => r.url))];
    },
    _contentStore: contentStore,
    _resultStore: resultStore,
  };
}

describe("spider handler", () => {
  it("initState returns results getter and viewers set", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    expect(state.results).toEqual([]);
    expect(state.viewers).toBeInstanceOf(Set);
  });

  it("onMessage with result type stores and notifies (includes contentType and size)", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    const pushToViewers = vi.fn();
    handler.onMessage(state, {
      type: "result",
      url: "https://example.com",
      status: 200,
      depth: 0,
      contentType: "text/html",
      size: 1024,
    }, pushToViewers);

    expect(state.results.length).toBe(1);
    expect(state.results[0].url).toBe("https://example.com");
    expect(db._resultStore[0].contentType).toBe("text/html");
    expect(db._resultStore[0].size).toBe(1024);
    expect(pushToViewers).toHaveBeenCalled();
  });

  it("onMessage with status broadcasts to viewers", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    const ws = { readyState: 1, send: vi.fn() };
    state.viewers.add(ws);

    handler.onMessage(state, { type: "status", discovered: 5, crawled: 3, queued: 2 }, vi.fn());
    expect(ws.send).toHaveBeenCalled();
    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg.type).toBe("status");
    expect(msg.discovered).toBe(5);
  });

  it("onMessage with done broadcasts to viewers", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    const ws = { readyState: 1, send: vi.fn() };
    state.viewers.add(ws);

    handler.onMessage(state, { type: "done", discovered: 10, crawled: 10 }, vi.fn());
    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg.type).toBe("done");
  });

  it("onMessage with exfiltrate-progress forwards to viewers", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    const ws = { readyState: 1, send: vi.fn() };
    state.viewers.add(ws);

    handler.onMessage(state, {
      type: "exfiltrate-progress",
      url: "https://example.com/secret",
      status: "done",
      size: 512,
    }, vi.fn());
    expect(ws.send).toHaveBeenCalled();
    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg.type).toBe("exfiltrate-progress");
    expect(msg.url).toBe("https://example.com/secret");
    expect(msg.status).toBe("done");
  });

  it("onViewerConnect sends init with current results and contentUrls", () => {
    const db = makeMockDb();
    db.insertSpiderResult("client-1", "https://a.com", 200, 0, Date.now());
    db.insertSpiderContent("client-1", "https://a.com", "text/html", Buffer.from("<h1>"), 4, Date.now());
    const state = handler.initState(db, "client-1");
    const ws = { readyState: 1, send: vi.fn(), on: vi.fn() };

    handler.onViewerConnect(state, ws);
    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg.type).toBe("init");
    expect(msg.results.length).toBe(1);
    expect(msg.results[0].url).toBe("https://a.com");
    expect(Array.isArray(msg.contentUrls)).toBe(true);
    expect(msg.contentUrls).toContain("https://a.com");
  });

  it("pushToAllViewers includes contentUrls", () => {
    const db = makeMockDb();
    db.insertSpiderResult("client-1", "https://b.com", 200, 0, Date.now());
    db.insertSpiderContent("client-1", "https://b.com", "text/html", Buffer.from("x"), 1, Date.now());
    const state = handler.initState(db, "client-1");
    const ws = { readyState: 1, send: vi.fn() };
    state.viewers.add(ws);

    handler.pushToAllViewers(state);
    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg.type).toBe("results");
    expect(msg.contentUrls).toContain("https://b.com");
  });
});

describe("spider handler — onBinary", () => {
  function buildContentData(url, contentType, content) {
    const meta = JSON.stringify({ url, contentType });
    const metaBytes = Buffer.from(meta);
    const contentBytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const frame = Buffer.allocUnsafe(4 + metaBytes.length + contentBytes.length);
    frame.writeUInt32BE(metaBytes.length, 0);
    metaBytes.copy(frame, 4);
    contentBytes.copy(frame, 4 + metaBytes.length);
    return frame;
  }

  it("stores content and broadcasts content-stored to viewers", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    const ws = { readyState: 1, send: vi.fn() };
    state.viewers.add(ws);

    const data = buildContentData("https://example.com/page", "text/html", "<h1>Hello</h1>");
    handler.onBinary(state, data, vi.fn());

    expect(db._contentStore).toHaveLength(1);
    expect(db._contentStore[0].url).toBe("https://example.com/page");
    expect(db._contentStore[0].contentType).toBe("text/html");

    expect(ws.send).toHaveBeenCalled();
    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg.type).toBe("content-stored");
    expect(msg.url).toBe("https://example.com/page");
    expect(msg.contentType).toBe("text/html");
    expect(msg.size).toBeGreaterThan(0);
  });

  it("ignores truncated frames (less than 4 bytes)", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    handler.onBinary(state, Buffer.from([0x00, 0x01]), vi.fn());
    expect(db._contentStore).toHaveLength(0);
  });

  it("ignores frames with invalid JSON metadata", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");
    const bad = Buffer.allocUnsafe(8);
    bad.writeUInt32BE(4, 0);
    bad.write("????", 4, "utf8");
    handler.onBinary(state, bad, vi.fn());
    expect(db._contentStore).toHaveLength(0);
  });

  it("rejects content exceeding the hard size limit (50 MB)", () => {
    const db = makeMockDb();
    const state = handler.initState(db, "client-1");

    // Build a frame whose content portion claims 51MB (we fake it by patching metaLen so
    // the content slice starts at a point where length > 50MB is computed)
    const url = "https://example.com/big";
    const metaJson = JSON.stringify({ url, contentType: "application/octet-stream" });
    const metaBytes = Buffer.from(metaJson);
    // Attach a 1-byte body but set metaLen so total content = frame.length - 4 - metaLen
    // which we test via a spy: instead, just call onBinary with a large buffer
    const bigContent = Buffer.alloc(51 * 1024 * 1024); // 51 MB zeros
    const frame = Buffer.allocUnsafe(4 + metaBytes.length + bigContent.length);
    frame.writeUInt32BE(metaBytes.length, 0);
    metaBytes.copy(frame, 4);
    bigContent.copy(frame, 4 + metaBytes.length);

    handler.onBinary(state, frame, vi.fn());
    // Should be rejected — nothing stored
    expect(db._contentStore).toHaveLength(0);
  });
});
