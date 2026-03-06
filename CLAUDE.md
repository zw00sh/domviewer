# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

domviewer - a browser-based C2 tool for security research. A modular client-side JS loader iframes the target page, connects via WebSocket, and dynamically loads pluggable payload modules (domviewer, spider, proxy, keylogger) sent by the server. Each "payload link" has a UUID and a configurable set of enabled payloads. The domviewer payload captures and streams DOM state using JSON-encoded binary deltas. The spider payload crawls same-origin links.

## Commands

- `npm run build` - Bundle loader + payload modules to `dist/` (esbuild, IIFE, minified)
- `npm run build:web` - Build React dashboard frontend (`web/`)
- `npm run build:all` - Build both server bundles and web frontend
- `npm run dev` - Build server bundles in watch mode
- `npm run dev:web` - Start Vite dev server for web frontend
- `npm start` - Start C2 on port 3001 (C2_PORT env), management on port 3000 (MGMT_PORT env)
- `npm test` - Run test suite (Vitest)

## Testing

### Unit tests (Vitest)

- **Framework**: Vitest (`vitest run`)
- **Run**: `npm test`
- **Test location**: `tests/` directory, mirroring source structure; excludes `tests/e2e/`
- **Run tests after modifying**: server routes, WS protocol, payload handlers, or rendering logic
- Tests use real HTTP/WS servers on ephemeral ports with `:memory:` SQLite (see `tests/helpers/setup-server.js`)
- Use `ctx.createLink()`, `ctx.connectPayloadWs()`, `ctx.connectViewerWs()` helpers from setup
- Use `createMessageCollector()` / `doHandshake()` for WS message assertions
- `ctx.baseUrl` / `ctx.wsUrl` point to the management server; use `ctx.c2BaseUrl` for C2 routes
- New server features should have corresponding tests in `tests/server/` or `tests/server-payloads/`

### E2E tests (Playwright)

- **Framework**: Playwright (`npx playwright test`), Chromium only
- **Run**: `npm run test:e2e` (builds bundles first) or `SKIP_BUILD=1 npx playwright test` (faster, skips build)
- **Test location**: `tests/e2e/` — specs mirror UI feature areas
- **Config**: `playwright.config.js` — `testDir: tests/e2e/`, globalSetup/Teardown
- **Global setup** (`tests/e2e/global-setup.js`): builds server bundles (unless `SKIP_BUILD=1`), starts an in-memory server, writes ports to `tests/e2e/.server-urls.json`
- **Helpers** (`tests/e2e/helpers.js`): `loadServerUrls()`, `createLink()`, `injectAndWaitForClient()`, `openClientTab()`, `waitForViewerContent()`
- **Existing specs**: `tests/e2e/domviewer.spec.js` (3 tests), `tests/e2e/proxy.spec.js` (6 tests), `tests/e2e/keylogger.spec.js` (3 tests)
- New UI features (dashboard interactions, standalone pages, payload panels) should have corresponding E2E specs

## Architecture

Two independent HTTP servers share a SQLite database and a runtime state object:

- **C2 server** (`server/c2.js`): Payload WebSocket `/ws`, loader bundle `/payload.js/:linkId`. Default port 3001 (`C2_PORT` env).
- **Management server** (`server/management.js`): Viewer WebSocket `/view`, REST API `/api/*`, React SPA, test pages `/test*`. Default port 3000 (`MGMT_PORT` env).
- **Database** (`server/db.js`): SQLite via `better-sqlite3`. Persists links, clients, logs, spider results, keylogger entries across restarts. Use `:memory:` for tests.
- **State** (`server/state.js`): Shared runtime state — `activeClients` Map (live WS connections + payload handler state), `logViewers` Set, `storeLog()`, `readPayloadBundle()`.
- **Entrypoint** (`server/index.js`): `createServer(opts)` wires up DB → state → C2 + management. `opts.dbPath` defaults to `data/domviewer.db`.
- **Client loader** (`client/loader.js`): Injected into target page. Iframes target, connects C2 WS with exponential-backoff reconnection, re-sends `init` on reconnect with same `clientId`.
- **Client payloads** (`client/payloads/*.js`): Pluggable modules exporting `init({ iframe, send, on, clientId, baseUrl })` and optionally `destroy()`. Bundled separately, sent to client over WS at runtime.
  - `domviewer.js`: DOM capture/sync via JSON-encoded binary deltas + MutationObserver (uses `client/serialize.js`)
  - `spider.js`: Crawls same-origin links from iframe, reports discovered URLs
  - `proxy.js`: Hidden offscreen iframe, serialises DOM, streams to viewer, relays interactions back
  - `keylogger.js`: Capture-phase input/keydown/change listeners, batches entries every 500ms
- **Server payload handlers** (`server/payloads/*.js`): Per-payload server logic. `initState(db, clientId, storeLog)`, `onMessage()`, `onBinary()`, `onViewerConnect()`, `pushToAllViewers()`. Spider results and keylogger entries are DB-backed; domviewer/proxy node maps are ephemeral.
- **Shared modules** (`shared/`): Isomorphic modules used by client payloads, server handlers, and web frontend — `render.js` (DOM node map → HTML), `apply-delta.js` (apply JSON-encoded deltas), `binary-frame.js` (encode/decode binary frames), `codec.js` (JSON/TextEncoder encode/decode wrappers).
- **Build** (`esbuild.config.mjs`): Bundles `client/loader.js` → `dist/loader.bundle.js` and each `client/payloads/*.js` → `dist/payloads/*.bundle.js` as minified IIFEs with `globalName: "__payload__"`.

```
Target Browser          C2 Server (:3001)        Management Server (:3000)
┌──────────────┐       ┌──────────────────┐      ┌────────────────────────┐
│ loader.js    │──WS──▸│ /ws              │      │ React SPA (/)          │
│  ├ domviewer │       │   routes messages│      │ REST API (/api/*)      │
│  ├ proxy     │       │   to payload     │      │ Viewer WS (/view)      │
│  ├ spider    │       │   handlers       │      │ Test site (/test*)     │
│  └ keylogger │       └────────┬─────────┘      └──────────┬─────────────┘
└──────────────┘                │                            │
                                ▼                            ▼
                         ┌─────────────┐            ┌──────────────┐
                         │  state.js   │◂──────────▸│management.js │
                         │  (runtime)  │            │ (API + WS)   │
                         └──────┬──────┘            └──────────────┘
                                │
                                ▼
                         ┌─────────────┐
                         │  SQLite DB  │
                         │  (db.js)    │
                         └─────────────┘
```

## Key Files

| File | Role |
|---|---|
| `server/index.js` | Entrypoint: wires DB + state + C2 + management, starts on configured ports |
| `server/db.js` | SQLite database layer (schema + prepared-statement methods) |
| `server/state.js` | Shared runtime state (activeClients, logViewers, storeLog, readPayloadBundle) |
| `server/c2.js` | C2 server: payload WS, loader serving |
| `server/management.js` | Management server: viewer WS, API routes, React SPA, test pages |
| `server/middleware.js` | Shared Express middleware (requireLink, requireClient, etc.) |
| `server/ws-utils.js` | WebSocket utility helpers |
| `client/loader.js` | Client entry point: iframe, WS reconnection, payload loading protocol |
| `client/payloads/domviewer.js` | DOM capture/sync payload module |
| `client/payloads/spider.js` | Link crawler payload module |
| `client/payloads/proxy.js` | Interactive proxy payload module |
| `client/payloads/keylogger.js` | Keylogger payload module |
| `client/serialize.js` | `serializeFull()` and `syncMutations()` — DOM to node-map serialization |
| `server/payloads/domviewer.js` | Server-side domviewer handler (node-map state, viewer push) |
| `server/payloads/spider.js` | Server-side spider handler (DB-backed results, viewer push) |
| `server/payloads/proxy.js` | Server-side proxy handler (relay events between client and viewer) |
| `server/payloads/keylogger.js` | Server-side keylogger handler (DB-backed entries, viewer push) |
| `server/payloads/_dom-stream-base.js` | Shared base for DOM-streaming handlers (forwardToViewers, createOnBinary) |
| `shared/render.js` | `renderToHtml()` — node map to HTML string (isomorphic) |
| `shared/apply-delta.js` | `applyMessage()` — apply JSON-encoded delta to node map (isomorphic) |
| `shared/binary-frame.js` | Encode/decode binary frames with payload-name prefix (isomorphic) |
| `shared/codec.js` | JSON/TextEncoder encode/decode wrappers (isomorphic) |
| `web/src/lib/dom-viewer-core.ts` | TypeScript types + renderToHtml + applyMessage for web frontend |
| `esbuild.config.mjs` | Multi-entry build configuration |
| `data/domviewer.db` | SQLite database (auto-created, gitignored) |

## Protocol

1. Dashboard (management :3000) creates a "payload link" via `POST /api/links` → returns linkId
2. `GET /payload.js/:linkId` on C2 (:3001) → injects `__DV_LINK_ID__` and `__DV_SERVER__` into loader bundle
3. Loader iframes target page, connects C2 WS, sends `{ type: "init", clientId, linkId }`
4. C2 validates linkId from DB, upserts client, sends `{ type: "load", name, code, config }` for each enabled payload
5. Loader executes payload code, calls `init()` with API context (`send`, `on`, `iframe`, etc.) for each of the four payloads (domviewer, spider, proxy, keylogger)
6. Payload-specific messages flow via `{ type: "payload", name, data }` (text) or name-prefixed binary frames
7. C2 routes messages to appropriate payload handler, pushes to viewers via management WS
8. On disconnect: `activeClients` entry removed; DB record persists. On reconnect: same `clientId` re-sent, `upsertClient` updates connected_at, payload states re-initialized.

### Binary frame format
`[1 byte: name length N][N bytes: payload name UTF-8][rest: binary data]`

### Live payload updates
- `PATCH /api/links/:id` on management → updates DB template only (new clients inherit changes; does NOT push to connected clients)
- `PATCH /api/clients/:id` on management → updates client payloads + config and live-pushes `load`/`unload`/`config` to connected client

## Routes

**C2 server (port 3001)**
- `GET /payload.js/:linkId` - Loader bundle with injected link ID and C2 WS URL
- `WS /ws` - Payload WebSocket (client loader connects here)

**Management server (port 3000)**
- `GET /` - React SPA (dashboard)
- `GET /test*` - Multi-page test site (static HTML from `server/test/`)
- `WS /view` - Viewer WebSocket (live DOM viewer, spider results, proxy, log viewer)

### Test Site

The `/test*` route serves a static multi-page site from `server/test/`. There is no auto-creation of payload links — you must create one manually in the dashboard first.

**Important — Redirect URI**: When creating a payload link for use with the test site, set the **Redirect URI** to `http://localhost:3000/test`. Without this, the loader defaults to `location.origin` and will iframe the dashboard SPA itself instead of the test page.

To use:
1. Create a link in the dashboard with Redirect URI `http://localhost:3000/test`
2. Navigate to `http://localhost:3000/test`
3. Paste the `<script>` tag into the inject form on the test page

## API (management server, port 3000)

**Config**
- `GET /api/config` - Server config (C2 URL, etc.)

**Links**
- `POST /api/links` - Create payload link `{ payloads: ["domviewer", "spider", "proxy", "keylogger"] }`
- `GET /api/links` - List all links
- `GET /api/links/:id` - Get link details
- `PATCH /api/links/:id` - Update link payloads (DB template only — no live push)
- `DELETE /api/links/:id` - Delete link

**Clients**
- `GET /api/clients` - List all clients (with `connected` status)
- `GET /api/clients/:id` - Get single client
- `PATCH /api/clients/:id` - Update client payloads + config (live-pushes to connected client)
- `DELETE /api/clients/:id` - Destroy client (sends destroy to client, cascades DB records)

**Logs**
- `GET /api/clients/:id/logs` - Get client logs
- `GET /api/logs` - Get global logs

**Spider**
- `GET /api/clients/:id/spider/content` - List exfiltrated content URLs
- `GET /api/clients/:id/spider/content/latest` - Get latest version of each exfiltrated URL
- `GET /api/clients/:id/spider/content/:contentId` - Get specific content blob
- `GET /api/clients/:id/spider/download` - Download all spider content as zip
- `POST /api/clients/:id/spider/exfiltrate` - Trigger content exfiltration
- `POST /api/clients/:id/spider/crawl` - Trigger crawl

**Keylogger**
- `GET /api/clients/:id/keylogger/entries` - Get keylogger entries
- `POST /api/clients/:id/keylogger/clear` - Clear keylogger entries

# Instructions

1. Always document your code. Update documentation when changing functionality.
2. Review README.md after your changes and update it appropriately
3. Create tests and run the test suite for changes (where a test makes sense)
4. Prioritise logical code: if refactoring is necessary, check with the user but don't be shy to suggest it.
5. Wherever possible, use ShadCN components in place of custom building components
5. Wherever possible, use ShadCN components in place of custom building components
6. This repo is not yet at a release state. When adding or modifying features, don't worry about backwards-compatibility. If it is cleaner to remove or refactor old code, go for it.
7. After every set of changes, verify the Docker image builds successfully: `docker build -t domviewer .` 
8. Never suggest manual verification. Always test UI changes in the browser (see below), ensuring modified elements have the correct layout. Include instructions to do so in your plans.

# Browser Testing

## Tools

Two browser tools are available, each for a different purpose:

- **Chrome DevTools MCP** — for observing browser state (console logs, network
  requests, performance traces, screenshots). Uses MCP tool calls. Configured
  in `.mcp.json` (project-scoped, committed to repo).
- **Playwright CLI** — for driving browser interactions (clicks, form fills,
  navigation, multi-step flows). Runs via bash, no MCP overhead.

Both tools use the same Playwright-bundled Chromium binary. The Chrome DevTools
MCP is configured via `-e ./scripts/playwright-chromium.sh` which resolves the
latest Playwright Chromium revision dynamically.

Use DevTools to *see* what's happening. Use Playwright CLI to *do* things.

## When to Use Which

Use **Chrome DevTools MCP** when the task is:
- Reading console logs or errors
- Inspecting network requests and responses
- Running performance traces or measuring Core Web Vitals
- Taking a screenshot to verify visual state
- Executing a single JavaScript expression via evaluateScript

Use **Playwright CLI** (via bash) when the task is:
- Multi-step interactions (form fill → submit → verify result)
- Any flow where timing matters (animations, transitions, race conditions)
- Click sequences or navigation that must happen without delay between steps
- Cross-browser verification (Chromium, Firefox, WebKit)

If a task involves both observation and interaction, use both tools: DevTools for
reading state before/after, Playwright CLI for the interaction itself.

## Ephemeral vs Permanent Tests

There are two categories of test scripts in this project. They must stay
strictly separated.

### Permanent E2E tests

- Live in `tests/e2e/`
- Committed to the repo and run in CI
- Follow project conventions (Page Object Model, describe/test blocks, meaningful
  assertions, idempotent)
- Run with `npx playwright test`
- Use the project's `playwright.config.ts`

### Ephemeral agent tests

- Written by Claude during development to verify a fix, debug an issue, or
  test a flow
- Written to `/tmp/playwright-test-*.js` or `.playwright-scratch/`
- Never committed (`.playwright-scratch/` is in `.gitignore`)
- Run with `playwright-cli` commands (open, click, fill, eval, run-code, etc.)
- Never use `npx playwright test` — that picks up the project config and could
  interfere with the real suite

### Rules

- Never create, modify, or delete files in `tests/e2e/` unless explicitly asked
  to write or edit a permanent test.
- Never modify `playwright.config.ts` for ephemeral testing.
- Never import from or reference `.playwright-scratch/` in committed code.
- Never run ephemeral scripts with `npx playwright test`.

## Playwright CLI Usage

### CRITICAL: Avoiding Claude Code safety prompts

Claude Code flags bash commands that contain `${}` parameter substitution,
command separators (multiple commands in one invocation), multi-line strings,
backticks, or other shell metasyntax. Every flag pauses execution and requires
manual approval, which defeats the purpose of agentic testing.

**The golden rule: one simple command per bash call, no shell features.**

1. **Never combine multiple commands in a single bash call.** Claude Code flags
   "ambiguous syntax with command separators."
   ```bash
   # WRONG — two commands in one bash call
   playwright-cli open http://localhost:3000 --headed && playwright-cli click e15

   # RIGHT — each command in a separate bash invocation
   playwright-cli open http://localhost:3000 --headed
   ```
   ```bash
   playwright-cli click e15
   ```

2. **Never use shell variables or `${}` in any command.** Inline all values
   directly into the JavaScript. Do not set a bash variable and interpolate it.
   ```bash
   # WRONG — triggers "parameter substitution" warning
   CLIENT_ID="cb1779e3-7c26-4b3b-8c9b-aa9a6ccdee39"
   playwright-cli goto http://localhost:3000/client/${CLIENT_ID}

   # RIGHT — value inlined directly
   playwright-cli goto http://localhost:3000/client/cb1779e3-7c26-4b3b-8c9b-aa9a6ccdee39
   ```

3. **`run-code` takes inline code, not a file path.** For simple expressions,
   use `eval` instead. For multi-step flows, use sequential `playwright-cli`
   commands (one per bash call) or write a script file and use `eval` to load it.
   ```bash
   # Simple expression
   playwright-cli eval "document.title"
   ```

4. **Never use backticks, `$(...)`, or `&&`/`;` to join commands.**

5. **Each playwright-cli command gets its own bash call.** Do not chain them.
   ```bash
   # Each of these is a separate bash invocation:
   playwright-cli open http://localhost:3000 --headed
   ```
   ```bash
   playwright-cli click e15
   ```
   ```bash
   playwright-cli screenshot
   ```

### Starting a session

```bash
playwright-cli open http://localhost:3000 --headed
```

For localhost testing, detect running dev servers first before hardcoding a port.

### Simple interactions

After `open`, each command returns a YAML snapshot with element references
(e.g., `e15`, `e22`). Use these refs in subsequent commands:

```bash
playwright-cli click e15
```
```bash
playwright-cli fill e22 "test@example.com"
```
```bash
playwright-cli press Enter
```
```bash
playwright-cli screenshot
```

### Atomic multi-step flows

For time-sensitive sequences that must execute without LLM round-trips between
steps, use `run-code` with an inline JavaScript snippet. The `run-code` command
takes a code string (not a file path) and executes it against the current page:

```bash
playwright-cli run-code "await page.fill('#email', 'test@example.com'); await page.click('[data-testid=submit]'); await page.waitForURL('**/confirmation');"
```

For longer scripts, use `eval` to run JavaScript in the page context:

```bash
playwright-cli eval "document.querySelector('#result').textContent"
```

### Closing

```bash
playwright-cli close
```

## Chrome DevTools MCP Usage

Refer to the tools listed under `/mcp → chrome-devtools`. Common patterns:

- `navigate_page` + `list_console_messages` — check for errors after navigation
- `navigate_page` + `list_network_requests` — inspect API calls
- `performance_start_trace` + `performance_analyze_insight` — measure Core Web
  Vitals
- `take_screenshot` — quick visual verification
- `evaluate_script` — run JS in the page context (use for batching multiple
  reads into a single call to avoid round-trips)

When using evaluateScript for multiple DOM reads, batch them into a single call
that returns a JSON object rather than making separate calls for each value.

## Promoting an Ephemeral Test

If asked to keep an ephemeral test or add it to the suite:

1. Rewrite it in `tests/e2e/` following project conventions (Page Object Model,
   describe/test blocks, proper assertions).
2. Make sure it is idempotent and does not depend on transient state.
3. Delete the ephemeral version from `/tmp` or `.playwright-scratch/`.
4. Run the full suite (`npx playwright test`) to verify no conflicts.