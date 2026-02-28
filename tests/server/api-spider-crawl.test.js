import { describe, it, expect, afterEach } from "vitest";
import {
  startTestServer,
  doHandshake,
  createMessageCollector,
} from "../helpers/setup-server.js";

let ctx;

afterEach(async () => {
  if (ctx) await ctx.close();
  ctx = null;
});

describe("POST /api/clients/:id/spider/crawl", () => {
  it("returns 404 for unknown client", async () => {
    ctx = await startTestServer();
    const res = await fetch(`${ctx.baseUrl}/api/clients/unknown-client/spider/crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seeds: ["https://example.com/"] }),
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

    const res = await fetch(`${ctx.baseUrl}/api/clients/${clientId}/spider/crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seeds: ["https://example.com/"] }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 400 when seeds is missing or empty", async () => {
    ctx = await startTestServer();
    const { id: linkId } = await ctx.createLink(["spider"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, linkId);

    const res = await fetch(`${ctx.baseUrl}/api/clients/${clientId}/spider/crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seeds: [] }),
    });
    expect(res.status).toBe(400);

    ws.close();
  });

  it("returns 400 when seeds field is omitted", async () => {
    ctx = await startTestServer();
    const { id: linkId } = await ctx.createLink(["spider"]);
    const ws = await ctx.connectPayloadWs();
    const { clientId } = await doHandshake(ws, linkId);

    const res = await fetch(`${ctx.baseUrl}/api/clients/${clientId}/spider/crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);

    ws.close();
  });

  it("forwards crawl command to connected client", async () => {
    ctx = await startTestServer();
    const { id: linkId } = await ctx.createLink(["spider"]);
    const ws = await ctx.connectPayloadWs();
    const collector = createMessageCollector(ws);
    const { clientId } = await doHandshake(ws, linkId);

    const seeds = ["https://example.com/admin", "https://example.com/api"];

    // Set up collector BEFORE triggering the request to avoid race conditions
    const waitForCrawl = collector.wait(
      (m) => m.type === "payload" && m.name === "spider" && m.data?.type === "crawl",
      3000
    );

    const triggerRes = await fetch(`${ctx.baseUrl}/api/clients/${clientId}/spider/crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seeds }),
    });
    expect(triggerRes.status).toBe(200);
    const body = await triggerRes.json();
    expect(body.ok).toBe(true);
    expect(body.seeds).toBe(2);

    const msg = await waitForCrawl;
    expect(msg.data.seeds).toEqual(seeds);

    ws.close();
  });
});
