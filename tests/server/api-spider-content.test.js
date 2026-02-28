import { describe, it, expect, afterEach } from "vitest";
import {
  startTestServer,
  doHandshake,
  createMessageCollector,
  makeBinaryFrame,
} from "../helpers/setup-server.js";

let ctx;

afterEach(async () => {
  if (ctx) await ctx.close();
  ctx = null;
});

/**
 * Builds the binary data payload for the spider content upload format:
 *   [4 bytes: JSON metadata length BE uint32][JSON][content bytes]
 */
function buildSpiderContentData(url, contentType, content) {
  const meta = JSON.stringify({ url, contentType });
  const metaBytes = Buffer.from(meta);
  const contentBytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const frame = Buffer.allocUnsafe(4 + metaBytes.length + contentBytes.length);
  frame.writeUInt32BE(metaBytes.length, 0);
  metaBytes.copy(frame, 4);
  contentBytes.copy(frame, 4 + metaBytes.length);
  return frame;
}

describe("GET /api/clients/:id/spider/content", () => {
  it("returns 404 for unknown client", async () => {
    ctx = await startTestServer();
    const res = await fetch(
      `${ctx.baseUrl}/api/clients/unknown-client/spider/content?url=${encodeURIComponent("https://a.com")}`
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when url param is missing", async () => {
    ctx = await startTestServer();
    const { id: linkId } = await ctx.createLink(["spider"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, linkId);
    ws.close();

    const res = await fetch(`${ctx.baseUrl}/api/clients/${clientId}/spider/content`);
    expect(res.status).toBe(400);
  });

  it("returns empty array when no content stored", async () => {
    ctx = await startTestServer();
    const { id: linkId } = await ctx.createLink(["spider"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, linkId);
    ws.close();

    const res = await fetch(
      `${ctx.baseUrl}/api/clients/${clientId}/spider/content?url=${encodeURIComponent("https://a.com/page")}`
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  it("returns versions after binary upload via WS", async () => {
    ctx = await startTestServer();
    const { id: linkId } = await ctx.createLink(["spider"]);
    const ws = await ctx.connectPayloadWs();
    const collector = createMessageCollector(ws);
    const { clientId } = await doHandshake(ws, linkId);

    // Upload content via binary frame
    const url = "https://example.com/page";
    const contentData = buildSpiderContentData(url, "text/html", "<h1>Hello</h1>");
    const binaryFrame = makeBinaryFrame("spider", new Uint8Array(contentData));
    ws.send(binaryFrame, { binary: true });

    // Small wait to let the server process the frame
    await new Promise((r) => setTimeout(r, 100));

    const res = await fetch(
      `${ctx.baseUrl}/api/clients/${clientId}/spider/content?url=${encodeURIComponent(url)}`
    );
    expect(res.status).toBe(200);
    const versions = await res.json();
    expect(versions.length).toBeGreaterThan(0);
    expect(versions[0].url).toBe(url);
    expect(versions[0].contentType).toBe("text/html");
    expect(versions[0].size).toBeGreaterThan(0);

    ws.close();
  });
});

describe("GET /api/clients/:id/spider/content/:contentId", () => {
  it("returns 404 for unknown content ID", async () => {
    ctx = await startTestServer();
    const { id: linkId } = await ctx.createLink(["spider"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, linkId);
    ws.close();

    const res = await fetch(`${ctx.baseUrl}/api/clients/${clientId}/spider/content/9999`);
    expect(res.status).toBe(404);
  });

  it("returns raw content with correct Content-Type", async () => {
    ctx = await startTestServer();
    const { id: linkId } = await ctx.createLink(["spider"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, linkId);

    const url = "https://example.com/data.json";
    const contentData = buildSpiderContentData(url, "application/json", '{"ok":true}');
    const binaryFrame = makeBinaryFrame("spider", new Uint8Array(contentData));
    ws.send(binaryFrame, { binary: true });

    await new Promise((r) => setTimeout(r, 100));

    // Get version list
    const versRes = await fetch(
      `${ctx.baseUrl}/api/clients/${clientId}/spider/content?url=${encodeURIComponent(url)}`
    );
    const versions = await versRes.json();
    expect(versions.length).toBeGreaterThan(0);

    // Download by ID
    const dlRes = await fetch(
      `${ctx.baseUrl}/api/clients/${clientId}/spider/content/${versions[0].id}`
    );
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers.get("content-type")).toContain("application/json");
    const body = await dlRes.text();
    expect(body).toBe('{"ok":true}');

    ws.close();
  });
});

describe("GET /api/clients/:id/spider/download", () => {
  it("returns 404 when no content exists for prefix", async () => {
    ctx = await startTestServer();
    const { id: linkId } = await ctx.createLink(["spider"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, linkId);
    ws.close();

    const res = await fetch(
      `${ctx.baseUrl}/api/clients/${clientId}/spider/download?path=${encodeURIComponent("https://example.com/")}`
    );
    expect(res.status).toBe(404);
  });

  it("returns a zip archive when content exists", async () => {
    ctx = await startTestServer();
    const { id: linkId } = await ctx.createLink(["spider"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, linkId);

    // Upload two pages
    for (const [url, html] of [
      ["https://example.com/a", "<h1>A</h1>"],
      ["https://example.com/b", "<h1>B</h1>"],
    ]) {
      const contentData = buildSpiderContentData(url, "text/html", html);
      ws.send(makeBinaryFrame("spider", new Uint8Array(contentData)), { binary: true });
    }

    await new Promise((r) => setTimeout(r, 200));

    const res = await fetch(
      `${ctx.baseUrl}/api/clients/${clientId}/spider/download?path=${encodeURIComponent("https://example.com/")}`
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/zip");

    ws.close();
  });
});

describe("POST /api/clients/:id/spider/exfiltrate", () => {
  it("returns 404 for unknown client", async () => {
    ctx = await startTestServer();
    const res = await fetch(`${ctx.baseUrl}/api/clients/unknown/spider/exfiltrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: ["https://example.com"] }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when client is disconnected", async () => {
    ctx = await startTestServer();
    const { id: linkId } = await ctx.createLink(["spider"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, linkId);
    ws.close();

    // Wait for disconnect to be processed
    await new Promise((r) => setTimeout(r, 100));

    const res = await fetch(`${ctx.baseUrl}/api/clients/${clientId}/spider/exfiltrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: ["https://example.com"] }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 400 when urls is missing or empty", async () => {
    ctx = await startTestServer();
    const { id: linkId } = await ctx.createLink(["spider"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, linkId);

    const res = await fetch(`${ctx.baseUrl}/api/clients/${clientId}/spider/exfiltrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: [] }),
    });
    expect(res.status).toBe(400);

    ws.close();
  });

  it("forwards exfiltrate command to connected client", async () => {
    ctx = await startTestServer();
    const { id: linkId } = await ctx.createLink(["spider"]);
    const ws = await ctx.connectPayloadWs();
    const collector = createMessageCollector(ws);
    const { clientId } = await doHandshake(ws, linkId);

    const urls = ["https://example.com/secret"];
    const triggerRes = await fetch(`${ctx.baseUrl}/api/clients/${clientId}/spider/exfiltrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    expect(triggerRes.status).toBe(200);

    const msg = await collector.wait(
      (m) => m.type === "payload" && m.name === "spider" && m.data?.type === "exfiltrate",
      3000
    );
    expect(msg.data.urls).toEqual(urls);

    ws.close();
  });
});
