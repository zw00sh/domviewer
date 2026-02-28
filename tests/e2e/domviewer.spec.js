/**
 * DomViewer E2E tests.
 *
 * Two browser contexts per test: one "victim" page that loads the payload
 * and one "viewer" page that shows the mirrored DOM.  Both connect through
 * the in-memory server started in global-setup.js.
 *
 * The loader wipes the victim page and iframes the redirectUri target.  All
 * DOM interactions (button clicks) must be performed via frameLocator because
 * the interactive content lives inside the loader's iframe, not the main frame.
 */
import { test, expect } from "@playwright/test";
import {
  loadServerUrls,
  createLink,
  injectAndWaitForClient,
  openClientTab,
} from "./helpers.js";

let MGMT_URL, C2_URL;

test.beforeAll(() => {
  ({ MGMT_URL, C2_URL } = loadServerUrls());
});

test("victim DOM mutations appear in viewer", async ({ browser }) => {
  const victimCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const victimPage = await victimCtx.newPage();
  const viewerPage = await viewerCtx.newPage();

  // redirectUri makes the loader iframe /test so the domviewer captures the
  // test page DOM (buttons, sandbox) instead of the SPA dashboard.
  const { scriptTag, linkId } = await createLink(MGMT_URL, C2_URL, ["domviewer"], `${MGMT_URL}/test`);

  await victimPage.goto(`${MGMT_URL}/test`);
  const clientId = await injectAndWaitForClient(victimPage, MGMT_URL, scriptTag, linkId);

  await openClientTab(viewerPage, MGMT_URL, clientId, "domviewer");

  // The domviewer panel renders a sandboxed iframe — wait for its content
  const frame = viewerPage.frameLocator('iframe[sandbox]');
  await expect(frame.locator("body")).not.toBeEmpty({ timeout: 15_000 });

  // The loader wipes the victim's main frame and replaces it with a full-viewport
  // iframe loading the redirectUri.  Buttons are inside that loader iframe.
  const loaderFrame = victimPage.frameLocator("iframe");
  await loaderFrame.locator("#btn-add").click();

  // The new element text should appear in the viewer iframe
  await expect(frame.locator("#sandbox")).toContainText("Added element #1", { timeout: 10_000 });

  await victimCtx.close();
  await viewerCtx.close();
});

test("text content mutations sync to viewer", async ({ browser }) => {
  const victimCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const victimPage = await victimCtx.newPage();
  const viewerPage = await viewerCtx.newPage();

  const { scriptTag, linkId } = await createLink(MGMT_URL, C2_URL, ["domviewer"], `${MGMT_URL}/test`);

  await victimPage.goto(`${MGMT_URL}/test`);
  const clientId = await injectAndWaitForClient(victimPage, MGMT_URL, scriptTag, linkId);

  await openClientTab(viewerPage, MGMT_URL, clientId, "domviewer");

  const frame = viewerPage.frameLocator('iframe[sandbox]');
  await expect(frame.locator("body")).not.toBeEmpty({ timeout: 15_000 });

  // Interact via the loader iframe; also add a child first so btn-text has something to change
  const loaderFrame = victimPage.frameLocator("iframe");
  await loaderFrame.locator("#btn-add").click();
  await loaderFrame.locator("#btn-text").click();

  // The viewer should reflect the changed text
  await expect(frame.locator("#sandbox")).toContainText("Text changed", { timeout: 10_000 });

  await victimCtx.close();
  await viewerCtx.close();
});

test("attribute mutations sync to viewer", async ({ browser }) => {
  const victimCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const victimPage = await victimCtx.newPage();
  const viewerPage = await viewerCtx.newPage();

  const { scriptTag, linkId } = await createLink(MGMT_URL, C2_URL, ["domviewer"], `${MGMT_URL}/test`);

  await victimPage.goto(`${MGMT_URL}/test`);
  const clientId = await injectAndWaitForClient(victimPage, MGMT_URL, scriptTag, linkId);

  await openClientTab(viewerPage, MGMT_URL, clientId, "domviewer");

  const frame = viewerPage.frameLocator('iframe[sandbox]');
  await expect(frame.locator("body")).not.toBeEmpty({ timeout: 15_000 });

  // Add an element first so btn-attr has something to highlight
  const loaderFrame = victimPage.frameLocator("iframe");
  await loaderFrame.locator("#btn-add").click();
  await loaderFrame.locator("#btn-attr").click();

  // The highlighted class should appear in the viewer iframe
  await expect(frame.locator("#sandbox .highlighted")).toBeVisible({ timeout: 10_000 });

  await victimCtx.close();
  await viewerCtx.close();
});
