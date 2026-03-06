# Browser Testing Setup

This project uses two browser tools for Claude Code-driven testing. Both share the
same Playwright-bundled Chromium binary for consistency.

## Prerequisites

- Node.js 18+
- npm

## Installation

### 1. Playwright (E2E tests + CLI interactions)

```bash
# Install Playwright as a project dependency (already in package.json)
npm install

# Install Chromium browser binary
npx playwright install chromium
```

This downloads Chrome for Testing into `~/Library/Caches/ms-playwright/` (macOS)
or `~/.cache/ms-playwright/` (Linux).

### 2. Playwright CLI (interactive browser tool)

```bash
# Install globally via Homebrew
brew install nicepkg/tap/playwright-cli

# Or via npm
npm install -g playwright-cli
```

Verify:
```bash
playwright-cli --help
```

### 3. Chrome DevTools MCP (observation tool)

```bash
# Install globally via npm
npm install -g chrome-devtools-mcp
```

Verify:
```bash
chrome-devtools-mcp --version
```

## Configuration

### MCP Server (`.mcp.json`)

The Chrome DevTools MCP server is configured in `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "chrome-devtools-mcp": {
      "type": "stdio",
      "command": "chrome-devtools-mcp",
      "args": [
        "--no-usage-statistics",
        "-e",
        "./scripts/playwright-chromium.sh"
      ]
    }
  }
}
```

The `-e` flag points to `scripts/playwright-chromium.sh`, a wrapper that
dynamically resolves the latest Playwright-bundled Chromium binary. This ensures
both tools use the same browser version.

When Claude Code starts a session in this project, it reads `.mcp.json` and
launches the MCP server automatically. No manual `claude mcp add` needed.

### Shared Chromium Binary

Both tools use the same Chromium:
- **Playwright CLI** uses its bundled Chromium directly
- **Chrome DevTools MCP** uses it via `scripts/playwright-chromium.sh`

When Playwright updates and downloads a new browser revision, the wrapper
automatically picks up the latest version. After updating Playwright:

```bash
npx playwright install chromium
```

Then restart your Claude Code session to pick up the new binary for DevTools MCP.

## Usage

### Playwright CLI (interactions)

```bash
# Open a browser session
playwright-cli open http://localhost:3000 --headed

# Interact using element refs from snapshots
playwright-cli click e15
playwright-cli fill e22 "test@example.com"
playwright-cli press Enter
playwright-cli screenshot

# Evaluate JS in page context
playwright-cli eval "document.title"

# Run inline Playwright code
playwright-cli run-code "await page.click('#submit'); await page.waitForURL('**/result');"

# Close browser
playwright-cli close
```

### Chrome DevTools MCP (observation)

Used via Claude Code MCP tool calls (not bash). Common operations:

- `take_screenshot` - visual verification
- `navigate_page` - navigate to URL
- `list_console_messages` - check for errors
- `list_network_requests` - inspect API calls
- `evaluate_script` - run JS expressions
- `performance_start_trace` / `performance_analyze_insight` - measure performance

### E2E Test Suite (Playwright)

```bash
# Run full E2E suite (builds first)
npm run test:e2e

# Run without rebuilding (faster)
SKIP_BUILD=1 npx playwright test

# Run a specific test file
SKIP_BUILD=1 npx playwright test tests/e2e/domviewer.spec.js
```

## Troubleshooting

### "No Playwright Chromium found"

Run `npx playwright install chromium` to download the browser binary.

### MCP server not connecting

1. Check `.mcp.json` exists at the project root
2. Verify `chrome-devtools-mcp` is installed: `which chrome-devtools-mcp`
3. Verify the wrapper works: `./scripts/playwright-chromium.sh --version`
4. Restart Claude Code to reload MCP servers

### playwright-cli "browser not open"

`run-code` and other interaction commands require an open browser session:
```bash
playwright-cli open http://localhost:3000 --headed
```

### Port conflicts

If the dev servers are already running, detect them first:
```bash
lsof -i :3000 -i :3001
```
