import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer } from "../helpers/setup-server.js";

describe("API /api/links", () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("POST creates link with valid payloads", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["domviewer", "spider"] }),
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.id).toBeTruthy();
    expect(data.payloads).toEqual(["domviewer", "spider"]);
  });

  it("POST with invalid payloads returns 400", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["nonexistent"] }),
    });
    expect(res.status).toBe(400);
  });

  it("POST with no body defaults to domviewer", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    expect(data.payloads).toEqual(["domviewer"]);
  });

  it("GET /api/links/:id returns link", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const res = await fetch(`${ctx.baseUrl}/api/links/${link.id}`);
    const data = await res.json();
    expect(data.id).toBe(link.id);
    expect(data.payloads).toEqual(["domviewer"]);
  });

  it("GET /api/links/:id returns 404 for unknown", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/links/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("GET /api/links lists all", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/links`);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it("PATCH /api/links/:id updates payloads", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const res = await fetch(`${ctx.baseUrl}/api/links/${link.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["domviewer", "spider"] }),
    });
    const data = await res.json();
    expect(data.payloads).toEqual(["domviewer", "spider"]);
  });

  it("PATCH /api/links/:id returns 404 for unknown", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/links/nonexistent`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["domviewer"] }),
    });
    expect(res.status).toBe(404);
  });

  it("POST creates link with redirectUri", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["domviewer"], redirectUri: "https://example.com" }),
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.redirectUri).toBe("https://example.com");
    expect(ctx.links.get(data.id).redirectUri).toBe("https://example.com");
  });

  it("POST without redirectUri sets it to null", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["domviewer"] }),
    });
    const data = await res.json();
    expect(ctx.links.get(data.id).redirectUri).toBeNull();
  });

  it("PATCH /api/links/:id updates redirectUri", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const res = await fetch(`${ctx.baseUrl}/api/links/${link.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["domviewer"], redirectUri: "https://evil.com" }),
    });
    expect(res.status).toBe(200);
    expect(ctx.links.get(link.id).redirectUri).toBe("https://evil.com");
  });

  it("PATCH /api/links/:id clears redirectUri with empty string", async () => {
    // First create with a redirectUri
    const createRes = await fetch(`${ctx.baseUrl}/api/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["domviewer"], redirectUri: "https://example.com" }),
    });
    const link = await createRes.json();

    // Then clear it
    const res = await fetch(`${ctx.baseUrl}/api/links/${link.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["domviewer"], redirectUri: "" }),
    });
    expect(res.status).toBe(200);
    expect(ctx.links.get(link.id).redirectUri).toBeNull();
  });

  it("POST with explicit empty payloads creates link", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: [] }),
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.id).toBeTruthy();
    expect(data.payloads).toEqual([]);
  });

  it("PATCH to empty payloads succeeds", async () => {
    const link = await ctx.createLink(["domviewer"]);
    const res = await fetch(`${ctx.baseUrl}/api/links/${link.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: [] }),
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.payloads).toEqual([]);
  });

  it("PATCH /api/links/:id without redirectUri leaves it unchanged", async () => {
    const createRes = await fetch(`${ctx.baseUrl}/api/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["domviewer"], redirectUri: "https://example.com" }),
    });
    const link = await createRes.json();

    const res = await fetch(`${ctx.baseUrl}/api/links/${link.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloads: ["domviewer", "spider"] }),
    });
    expect(res.status).toBe(200);
    expect(ctx.links.get(link.id).redirectUri).toBe("https://example.com");
  });

});
