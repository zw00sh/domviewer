import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase } from "../../server/db.js";

let db;

beforeEach(() => {
  db = createDatabase(":memory:");
  db.insertLink("link-1", ["spider", "keylogger", "cookies"], null);
  db.insertClient("client-1", "link-1", ["spider", "keylogger", "cookies"]);
});

afterEach(() => {
  db.close();
});

describe("getClientHasData", () => {
  it("returns all false when no data exists", () => {
    const result = db.getClientHasData("client-1");
    expect(result.spider).toBe(false);
    expect(result.keylogger).toBe(false);
    expect(result.cookies).toBe(false);
    expect(result.lastDataAt).toEqual({ spider: 0, keylogger: 0, cookies: 0 });
  });

  it("returns spider: true after a spider result is inserted", () => {
    db.insertSpiderResult("client-1", "https://example.com/", 200, 0, Date.now());
    const result = db.getClientHasData("client-1");
    expect(result.spider).toBe(true);
    expect(result.keylogger).toBe(false);
    expect(result.cookies).toBe(false);
  });

  it("returns keylogger: true after a keylogger entry is inserted", () => {
    db.insertKeyloggerEntry("client-1", "input#user", "text", "input", "a", "a", Date.now());
    const result = db.getClientHasData("client-1");
    expect(result.spider).toBe(false);
    expect(result.keylogger).toBe(true);
    expect(result.cookies).toBe(false);
  });

  it("returns cookies: true after a cookie entry is inserted", () => {
    db.insertCookieEntry("client-1", "session", "abc123", false, Date.now());
    const result = db.getClientHasData("client-1");
    expect(result.spider).toBe(false);
    expect(result.keylogger).toBe(false);
    expect(result.cookies).toBe(true);
  });

  it("returns all true when all tables have data", () => {
    const ts = Date.now();
    db.insertSpiderResult("client-1", "https://example.com/", 200, 0, ts);
    db.insertKeyloggerEntry("client-1", "input#user", "text", "input", "a", "a", ts);
    db.insertCookieEntry("client-1", "session", "abc", false, ts);
    const result = db.getClientHasData("client-1");
    expect(result.spider).toBe(true);
    expect(result.keylogger).toBe(true);
    expect(result.cookies).toBe(true);
    expect(result.lastDataAt.spider).toBe(ts);
    expect(result.lastDataAt.keylogger).toBe(ts);
    expect(result.lastDataAt.cookies).toBe(ts);
  });

  it("is isolated per client — another client's data does not affect results", () => {
    db.insertClient("client-2", "link-1", []);
    db.insertSpiderResult("client-2", "https://example.com/", 200, 0, Date.now());
    const result = db.getClientHasData("client-1");
    expect(result.spider).toBe(false);
  });
});
