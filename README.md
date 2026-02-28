# domviewer

A browser-based C2 tool for security research. A modular client-side JS loader iframes the target page, connects via WebSocket, and dynamically loads pluggable payload modules (domviewer, spider, proxy, keylogger) sent by the server. Each "payload link" has a UUID and a configurable set of enabled payloads.

## Quick Start

```bash
npm install
npm run build:all
npm start
```

- **Management dashboard**: `http://localhost:3000`
- **C2 server**: `http://localhost:3001`

## Architecture

Two independent HTTP servers share a SQLite database and runtime state:

- **C2 server** (port 3001): Payload WebSocket `/ws`, loader bundle `/payload.js/:linkId`
- **Management server** (port 3000): Viewer WebSocket `/view`, REST API `/api/*`, React SPA, test pages `/test*`

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

## Payloads

### domviewer

Captures and streams DOM state using JSON-encoded binary frames. A MutationObserver watches for changes and sends deltas every 500ms. The viewer renders the mirrored DOM as read-only HTML.

### spider

Crawls same-origin links from the target page and reports discovered URLs. Results are persisted in SQLite.

### keylogger

Attaches capture-phase `input`, `keydown`, and `change` listeners to the target's iframe document. Keystrokes and form field changes are batched and sent every 500ms. Entries are persisted in SQLite and displayed in the dashboard grouped by form element, with password fields masked by default.

### proxy

An interactive browser proxy that creates a hidden offscreen iframe on the victim, serialises its DOM, and streams it to the viewer. The viewer renders the DOM in a sandboxed iframe and relays user interactions back to the victim's real DOM:

- **Mouse events**: click, dblclick, mousedown, mouseup, mouseover, mouseout
- **Keyboard events**: keydown, keyup, with synthesised input events for text entry
- **Focus/blur**: explicit focus tracking with write-gating to prevent `doc.write()` from destroying the active cursor during typing
- **Value sync**: input `.value` (a DOM property, not an attribute) is round-tripped via `value-sync` messages so typed text reflects back in the viewer
- **Navigation**: link clicks and URL bar input navigate the victim's proxy iframe

## Routes

### C2 server (port 3001)

| Route | Description |
|---|---|
| `GET /payload.js/:linkId` | Loader bundle with injected link ID and C2 WS URL |
| `WS /ws` | Payload WebSocket (client loader connects here) |

### Management server (port 3000)

| Route | Description |
|---|---|
| `GET /` | React SPA dashboard |
| `GET /test*` | Multi-page test site (static HTML from `server/test/`) |
| `WS /view` | Viewer WebSocket (live DOM viewer, spider results, proxy, log viewer) |
| `GET /api/config` | Server config (C2 URL) |
| `POST /api/links` | Create payload link |
| `GET /api/links` | List all links |
| `GET /api/links/:id` | Get link details |
| `PATCH /api/links/:id` | Update link payloads (DB template only) |
| `DELETE /api/links/:id` | Delete link |
| `GET /api/clients` | List all clients |
| `GET /api/clients/:id` | Get single client |
| `PATCH /api/clients/:id` | Update client payloads + config (live push) |
| `DELETE /api/clients/:id` | Destroy client |
| `GET /api/clients/:id/logs` | Get client logs |
| `GET /api/logs` | Get global logs |
| `GET /api/clients/:id/spider/content` | List exfiltrated content URLs |
| `GET /api/clients/:id/spider/content/latest` | Get latest version of each content URL |
| `GET /api/clients/:id/spider/content/:contentId` | Get specific content blob |
| `GET /api/clients/:id/spider/download` | Download all spider content as zip |
| `POST /api/clients/:id/spider/exfiltrate` | Trigger content exfiltration |
| `POST /api/clients/:id/spider/crawl` | Trigger crawl |
| `GET /api/clients/:id/keylogger/entries` | Get keylogger entries |
| `POST /api/clients/:id/keylogger/clear` | Clear keylogger entries |

## How It Works

1. Create a payload link via the dashboard (`POST /api/links`).
2. Load `/payload.js/:linkId` on the target page. The loader iframes the target, connects to the C2 WebSocket, and receives payload modules.
3. Each payload module (domviewer, spider, proxy, keylogger) runs in the target's context and streams data to the server via text and binary WebSocket frames.
4. The server applies updates to per-client state and pushes them to connected viewer WebSockets.
5. The React dashboard renders live views — read-only DOM mirror, interactive proxy, spider results, keylogger entries.

Cross-origin link clicks in the captured page open in a new tab. Relative URLs and CSS `url()` references are resolved to absolute so assets load correctly in the viewer.

## Test Site

The management server exposes a static multi-page test site at `/test*` (served from `server/test/`). To use it:

1. Create a payload link in the dashboard. Set the **Redirect URI** to `http://localhost:3000/test`.
   > Without a redirect URI, the loader defaults to `location.origin` and will iframe the dashboard itself instead of the test page.
2. Navigate to `http://localhost:3000/test` in a browser.
3. Paste the `<script>` tag from the link detail page into the inject form on the test page.

## Docker

```bash
# Build image
docker build -t domviewer .

# Run with docker compose (recommended — persists DB volume)
docker compose up
```

The compose file mounts a named volume at `/app/data` so the SQLite database survives container restarts. Ports 3000 (management) and 3001 (C2) are exposed.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `C2_PORT` | `3001` | C2 server port |
| `MGMT_PORT` | `3000` | Management server port |
