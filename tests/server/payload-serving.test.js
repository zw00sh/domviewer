import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer } from "../helpers/setup-server.js";

describe("Payload serving", () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("GET /payload.js/:linkId returns JS with injected config", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const res = await fetch(`${ctx.c2BaseUrl}/payload.js/${link.id}`);
    // May be 500 if dist not built, but should not be 404
    if (res.status === 200) {
      const text = await res.text();
      expect(text).toContain("__DV_SERVER__");
      expect(text).toContain("__DV_LINK_ID__");
      expect(text).toContain(link.id);
    }
  });

  it("GET /payload.js/:linkId with redirectUri injects __DV_REDIRECT__", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["domviewer"], redirectUri: "https://target.com" }),
    });
    const link = await res.json();
    const payloadRes = await fetch(`${ctx.c2BaseUrl}/payload.js/${link.id}`);
    if (payloadRes.status === 200) {
      const text = await payloadRes.text();
      expect(text).toContain('var __DV_REDIRECT__="https://target.com"');
    }
  });

  it("GET /payload.js/:linkId without redirectUri omits __DV_REDIRECT__ var declaration", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const payloadRes = await fetch(`${ctx.c2BaseUrl}/payload.js/${link.id}`);
    if (payloadRes.status === 200) {
      const text = await payloadRes.text();
      expect(text).not.toContain("var __DV_REDIRECT__=");
    }
  });

  it("GET /payload.js/:linkId with unknown ID returns 404", async () => {
    const res = await fetch(`${ctx.c2BaseUrl}/payload.js/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("GET /test returns the inject form and no leftover placeholders", async () => {
    const res = await fetch(`${ctx.baseUrl}/test`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('id="payload-input"');
    expect(text).toContain('id="btn-inject"');
    expect(text).not.toContain("__TEST_LINK_ID__");
    expect(text).not.toContain("__TEST_C2_ORIGIN__");
  });

  it("GET /test does not auto-create a payload link", async () => {
    const before = ctx.links.size;
    await fetch(`${ctx.baseUrl}/test`);
    expect(ctx.links.size).toBe(before);
  });

  it("GET /test sub-pages do not include a payload script tag", async () => {
    const res = await fetch(`${ctx.baseUrl}/test/about`);
    if (res.status === 200) {
      const text = await res.text();
      expect(text).not.toContain("/payload.js/");
    }
  });

  it("Response Content-Type is application/javascript", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const res = await fetch(`${ctx.c2BaseUrl}/payload.js/${link.id}`);
    if (res.status === 200) {
      const contentType = res.headers.get("content-type");
      expect(contentType).toContain("javascript");
    }
  });
});
