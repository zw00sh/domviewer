import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer } from "../helpers/setup-server.js";

describe("GET /api/config", () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("returns 200 with a c2Url field", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const cfg = await res.json();
    expect(cfg).toHaveProperty("c2Url");
  });

  it("c2Url points to the C2 server (correct host and port)", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/config`);
    const cfg = await res.json();
    expect(cfg.c2Url).toBe(ctx.c2BaseUrl);
  });
});
