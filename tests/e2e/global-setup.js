import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { createServer } from "../../server/index.js";

const URLS_FILE = path.resolve("tests/e2e/.server-urls.json");

export default async function globalSetup() {
  // Build client bundles so the payload JS is available to serve.
  // Skip if SKIP_BUILD=1 to speed up iterative test runs.
  if (process.env.SKIP_BUILD !== "1") {
    console.log("[e2e] Building server bundles…");
    execSync("node esbuild.config.mjs", { stdio: "inherit" });
  }

  const { c2, management, db } = await createServer({ dbPath: ":memory:" });

  await new Promise((resolve) => c2.server.listen(0, resolve));
  await new Promise((resolve) => management.server.listen(0, resolve));

  const c2Port = c2.server.address().port;
  const mgmtPort = management.server.address().port;

  const urls = {
    MGMT_URL: `http://localhost:${mgmtPort}`,
    C2_URL: `http://localhost:${c2Port}`,
  };
  fs.writeFileSync(URLS_FILE, JSON.stringify(urls));

  // Keep server references alive for teardown via global state
  globalThis.__E2E_SERVERS__ = { c2: c2.server, management: management.server, db };
}
