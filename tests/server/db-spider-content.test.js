import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase } from "../../server/db.js";

let db;

beforeEach(() => {
  db = createDatabase(":memory:");
  // Insert required foreign-key records
  db.insertLink("link-1", ["spider"], null);
  db.insertClient("client-1", "link-1", ["spider"]);
});

afterEach(() => {
  db.close();
});

describe("spider_content DB layer", () => {
  it("insertSpiderContent stores a blob", () => {
    const content = Buffer.from("hello world");
    db.insertSpiderContent("client-1", "https://a.com/page", "text/html", content, content.length, 1000);

    const versions = db.getSpiderContentVersions("client-1", "https://a.com/page");
    expect(versions).toHaveLength(1);
    expect(versions[0].url).toBe("https://a.com/page");
    expect(versions[0].contentType).toBe("text/html");
    expect(versions[0].size).toBe(11);
    expect(versions[0].fetchedAt).toBe(1000);
  });

  it("supports multiple versions per URL, newest first", () => {
    const url = "https://a.com/page";
    db.insertSpiderContent("client-1", url, "text/html", Buffer.from("v1"), 2, 100);
    db.insertSpiderContent("client-1", url, "text/html", Buffer.from("v2"), 2, 200);
    db.insertSpiderContent("client-1", url, "text/html", Buffer.from("v3"), 2, 300);

    const versions = db.getSpiderContentVersions("client-1", url);
    expect(versions).toHaveLength(3);
    // Newest first
    expect(versions[0].fetchedAt).toBe(300);
    expect(versions[2].fetchedAt).toBe(100);
  });

  it("getSpiderContentById returns the full row with blob", () => {
    const content = Buffer.from("test content");
    db.insertSpiderContent("client-1", "https://a.com/file", "application/json", content, content.length, 500);

    const versions = db.getSpiderContentVersions("client-1", "https://a.com/file");
    expect(versions).toHaveLength(1);

    const row = db.getSpiderContentById(versions[0].id);
    expect(row).not.toBeNull();
    expect(row.content_type).toBe("application/json");
    expect(Buffer.from(row.content).toString()).toBe("test content");
  });

  it("getSpiderContentById returns null for unknown ID", () => {
    expect(db.getSpiderContentById(9999)).toBeNull();
  });

  it("getSpiderContentUrls returns distinct URLs", () => {
    db.insertSpiderContent("client-1", "https://a.com/p1", "text/html", Buffer.from("a"), 1, 100);
    db.insertSpiderContent("client-1", "https://a.com/p1", "text/html", Buffer.from("b"), 1, 200);
    db.insertSpiderContent("client-1", "https://a.com/p2", "text/html", Buffer.from("c"), 1, 300);

    const urls = db.getSpiderContentUrls("client-1");
    expect(urls).toHaveLength(2);
    expect(urls).toContain("https://a.com/p1");
    expect(urls).toContain("https://a.com/p2");
  });

  it("getSpiderContentUrls scopes to client", () => {
    db.insertLink("link-2", ["spider"], null);
    db.insertClient("client-2", "link-2", ["spider"]);
    db.insertSpiderContent("client-1", "https://a.com/p1", "text/html", Buffer.from("a"), 1, 100);
    db.insertSpiderContent("client-2", "https://b.com/p1", "text/html", Buffer.from("b"), 1, 200);

    expect(db.getSpiderContentUrls("client-1")).toEqual(["https://a.com/p1"]);
    expect(db.getSpiderContentUrls("client-2")).toEqual(["https://b.com/p1"]);
  });

  it("getSpiderContentByPrefix returns rows starting with prefix", () => {
    db.insertSpiderContent("client-1", "https://a.com/api/users", "application/json", Buffer.from("{}"), 2, 100);
    db.insertSpiderContent("client-1", "https://a.com/api/items", "application/json", Buffer.from("[]"), 2, 200);
    db.insertSpiderContent("client-1", "https://a.com/about", "text/html", Buffer.from("<h1>"), 4, 300);

    const apiRows = db.getSpiderContentByPrefix("client-1", "https://a.com/api/");
    expect(apiRows).toHaveLength(2);
    expect(apiRows.map((r) => r.url)).toContain("https://a.com/api/users");
    expect(apiRows.map((r) => r.url)).toContain("https://a.com/api/items");

    const allRows = db.getSpiderContentByPrefix("client-1", "https://a.com/");
    expect(allRows).toHaveLength(3);
  });

  it("deleteSpiderContentByClient removes all content for a client", () => {
    db.insertSpiderContent("client-1", "https://a.com/p1", "text/html", Buffer.from("a"), 1, 100);
    db.insertSpiderContent("client-1", "https://a.com/p2", "text/html", Buffer.from("b"), 1, 200);

    db.deleteSpiderContentByClient("client-1");
    expect(db.getSpiderContentUrls("client-1")).toHaveLength(0);
  });

  it("deleteClient cascades to spider_content", () => {
    db.insertSpiderContent("client-1", "https://a.com/p1", "text/html", Buffer.from("x"), 1, 100);
    db.deleteClient("client-1");

    // Client should be gone
    expect(db.getClient("client-1")).toBeNull();
    // Content should also be gone
    expect(db.getSpiderContentUrls("client-1")).toHaveLength(0);
  });
});

describe("config columns", () => {
  it("insertLink stores config and rowToLink parses it", () => {
    db.insertLink("link-cfg", ["spider"], null, { spider: { exfiltrate: true, limitTypes: false, maxFileSize: 5 * 1024 * 1024 } });
    const link = db.getLink("link-cfg");
    expect(link.config).toEqual({ spider: { exfiltrate: true, limitTypes: false, maxFileSize: 5 * 1024 * 1024 } });
  });

  it("updateLinkConfig updates the config", () => {
    db.updateLinkConfig("link-1", { spider: { exfiltrate: true } });
    const link = db.getLink("link-1");
    expect(link.config.spider.exfiltrate).toBe(true);
  });

  it("insertClient stores config and rowToClient parses it", () => {
    db.insertLink("link-c", ["spider"], null);
    db.insertClient("client-c", "link-c", ["spider"], { spider: { exfiltrate: false } });
    const c = db.getClient("client-c");
    expect(c.config).toEqual({ spider: { exfiltrate: false } });
  });

  it("updateClientConfig updates the config", () => {
    db.updateClientConfig("client-1", { spider: { exfiltrate: true, limitTypes: true, maxFileSize: 1024 } });
    const c = db.getClient("client-1");
    expect(c.config.spider.exfiltrate).toBe(true);
  });

  it("links default to empty config when none provided", () => {
    const link = db.getLink("link-1");
    expect(link.config).toEqual({});
  });

  it("clients default to empty config when none provided", () => {
    const c = db.getClient("client-1");
    expect(c.config).toEqual({});
  });
});

describe("spider_results extended columns", () => {
  it("insertSpiderResult stores contentType and size", () => {
    db.insertSpiderResult("client-1", "https://a.com", 200, 0, 1000, "text/html", 4096);
    const results = db.getSpiderResults("client-1");
    expect(results).toHaveLength(1);
    expect(results[0].contentType).toBe("text/html");
    expect(results[0].size).toBe(4096);
  });

  it("insertSpiderResult defaults contentType and size to empty/0", () => {
    db.insertSpiderResult("client-1", "https://b.com", 200, 0, 1000);
    const results = db.getSpiderResults("client-1");
    expect(results[0].contentType).toBe("");
    expect(results[0].size).toBe(0);
  });
});
