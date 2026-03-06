#!/bin/sh
# Wrapper to launch Playwright's bundled Chromium for use with chrome-devtools-mcp.
# Resolves the latest chromium revision in the Playwright cache dynamically.
# Supports macOS (arm64 + x64) and Linux.

# Determine Playwright cache directory
if [ "$(uname)" = "Darwin" ]; then
  CACHE_DIR="$HOME/Library/Caches/ms-playwright"
else
  CACHE_DIR="$HOME/.cache/ms-playwright"
fi

# Find the latest chromium-* directory (highest revision number)
CHROMIUM_DIR=$(ls -d "$CACHE_DIR"/chromium-* 2>/dev/null | sort -t- -k2 -n | tail -1)

if [ -z "$CHROMIUM_DIR" ]; then
  echo "Error: No Playwright Chromium found in $CACHE_DIR" >&2
  echo "Run: npx playwright install chromium" >&2
  exit 1
fi

# Resolve binary path per platform
if [ "$(uname)" = "Darwin" ]; then
  ARCH=$(uname -m)
  if [ "$ARCH" = "arm64" ]; then
    BINARY="$CHROMIUM_DIR/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
  else
    BINARY="$CHROMIUM_DIR/chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
  fi
else
  BINARY="$CHROMIUM_DIR/chrome-linux/chrome"
fi

if [ ! -x "$BINARY" ]; then
  echo "Error: Chromium binary not found at $BINARY" >&2
  echo "Run: npx playwright install chromium" >&2
  exit 1
fi

exec "$BINARY" "$@"
