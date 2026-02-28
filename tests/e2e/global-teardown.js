import fs from "fs";
import path from "path";

const URLS_FILE = path.resolve("tests/e2e/.server-urls.json");

export default async function globalTeardown() {
  const servers = globalThis.__E2E_SERVERS__;
  if (servers) {
    await new Promise((resolve) => servers.c2.close(resolve));
    await new Promise((resolve) => servers.management.close(resolve));
    servers.db?.close();
  }
  try { fs.unlinkSync(URLS_FILE); } catch (_) {}
}
