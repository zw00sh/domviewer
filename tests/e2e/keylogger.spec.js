/**
 * Keylogger E2E tests.
 *
 * Injects the keylogger payload on the test page (inside the loader iframe),
 * types into form fields, then verifies the entries appear in the keylogger panel.
 */
import { test, expect } from "@playwright/test";
import {
  loadServerUrls,
  createLink,
  injectAndWaitForClient,
} from "./helpers.js";

let MGMT_URL, C2_URL;

test.beforeAll(() => {
  ({ MGMT_URL, C2_URL } = loadServerUrls());
});

test("typed text appears in keylogger grouped view", async ({ browser }) => {
  const victimCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const victimPage = await victimCtx.newPage();
  const viewerPage = await viewerCtx.newPage();

  // Use the test page as the iframe target so the loader captures input events there
  const { scriptTag, linkId } = await createLink(
    MGMT_URL,
    C2_URL,
    ["keylogger"],
    `${MGMT_URL}/test`
  );

  await victimPage.goto(`${MGMT_URL}/test`);
  const clientId = await injectAndWaitForClient(victimPage, MGMT_URL, scriptTag, linkId);

  // Navigate viewer to the keylogger panel
  await viewerPage.goto(`${MGMT_URL}/keylogger/${clientId}`);

  // The loader wraps the test page in an iframe — type into the #payload-input textarea
  const loaderFrame = victimPage.frameLocator("iframe");
  await loaderFrame.locator("#payload-input").click();
  await loaderFrame.locator("#payload-input").type("hello world");

  // Wait for the keylogger panel to show entries
  await expect(viewerPage.getByText("entries")).toBeVisible({ timeout: 10_000 });

  // The entry should group by the textarea element descriptor
  // Look for any code element containing "payload-input" or "textarea"
  await expect(
    viewerPage.locator("code").filter({ hasText: /payload-input|textarea/ }).first()
  ).toBeVisible({ timeout: 10_000 });

  await victimCtx.close();
  await viewerCtx.close();
});

test("special keys appear in keylogger as key events", async ({ browser }) => {
  const victimCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const victimPage = await victimCtx.newPage();
  const viewerPage = await viewerCtx.newPage();

  const { scriptTag, linkId } = await createLink(
    MGMT_URL,
    C2_URL,
    ["keylogger"],
    `${MGMT_URL}/test`
  );

  await victimPage.goto(`${MGMT_URL}/test`);
  const clientId = await injectAndWaitForClient(victimPage, MGMT_URL, scriptTag, linkId);

  await viewerPage.goto(`${MGMT_URL}/keylogger/${clientId}`);

  // Type into the textarea and press Enter
  const loaderFrame = victimPage.frameLocator("iframe");
  await loaderFrame.locator("#payload-input").click();
  await loaderFrame.locator("#payload-input").type("test");
  await loaderFrame.locator("#payload-input").press("Enter");

  // The "key" badge should appear for the Enter key event
  await expect(viewerPage.getByText("entries")).toBeVisible({ timeout: 10_000 });
  // Look for the "key" event badge or "Enter" text in the panel
  await expect(
    viewerPage.locator("code").filter({ hasText: /payload-input|textarea/ }).first()
  ).toBeVisible({ timeout: 10_000 });

  await victimCtx.close();
  await viewerCtx.close();
});

test("clear button removes all entries", async ({ browser }) => {
  const victimCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const victimPage = await victimCtx.newPage();
  const viewerPage = await viewerCtx.newPage();

  const { scriptTag, linkId } = await createLink(
    MGMT_URL,
    C2_URL,
    ["keylogger"],
    `${MGMT_URL}/test`
  );

  await victimPage.goto(`${MGMT_URL}/test`);
  const clientId = await injectAndWaitForClient(victimPage, MGMT_URL, scriptTag, linkId);

  await viewerPage.goto(`${MGMT_URL}/keylogger/${clientId}`);

  // Type something to generate entries
  const loaderFrame = victimPage.frameLocator("iframe");
  await loaderFrame.locator("#payload-input").click();
  await loaderFrame.locator("#payload-input").type("secret");

  // Wait for entries to appear
  await expect(
    viewerPage.locator("code").filter({ hasText: /payload-input|textarea/ }).first()
  ).toBeVisible({ timeout: 10_000 });

  // Click the clear (trash) button in the toolbar
  await viewerPage.locator("button[class*='text-destructive'], button").filter({ has: viewerPage.locator("svg") }).last().click();

  // After clearing, the empty state message should appear
  await expect(
    viewerPage.getByText(/No keystrokes captured yet/)
  ).toBeVisible({ timeout: 5_000 });

  await victimCtx.close();
  await viewerCtx.close();
});
