import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./db.js";
import { createState } from "./state.js";
import { createC2Server } from "./c2.js";
import { createManagementServer } from "./management.js";

/**
 * Creates the full application: SQLite database, shared state, C2 server, and management server.
 * Async because createState auto-discovers and dynamically imports payload handlers.
 * @param {{ dbPath?: string }} opts
 * @returns {Promise<{ db, state, c2, management }>}
 */
export async function createServer(opts = {}) {
  const dbPath = opts.dbPath || "data/domviewer.db";
  const db = createDatabase(dbPath);
  const state = await createState(db);
  const c2 = createC2Server(state);
  const management = createManagementServer(state, { c2Server: c2.server });
  return { db, state, c2, management };
}

// Auto-start when run directly
const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const C2_PORT = parseInt(process.env.C2_PORT, 10) || 3001;
  const MGMT_PORT = parseInt(process.env.MGMT_PORT, 10) || 3000;

  const { c2, management } = await createServer();

  c2.server.listen(C2_PORT, () => {
    console.log(`[C2]   Listening on http://localhost:${C2_PORT}`);
    console.log(`       Payload WS:  ws://localhost:${C2_PORT}/ws`);
    console.log(`       Payload JS:  http://localhost:${C2_PORT}/payload.js/<linkId>`);
  });

  management.server.listen(MGMT_PORT, () => {
    console.log(`[MGMT] Listening on http://localhost:${MGMT_PORT}`);
    console.log(`       Dashboard:   http://localhost:${MGMT_PORT}/`);
    console.log(`       Viewer WS:   ws://localhost:${MGMT_PORT}/view`);
    console.log(`       API:         http://localhost:${MGMT_PORT}/api/`);
    console.log(`       Test site:   http://localhost:${MGMT_PORT}/test`);
  });
}
