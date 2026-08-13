import { expect, type Page, test } from "@playwright/test";

const configuredSessionSeconds = 2 * 60 * 60;
const rememberedSessionSeconds = 365 * 24 * 60 * 60;

const credentials = (): { email: string; password: string } | undefined => {
  const email = process.env.PRODUCT_STUDIO_BROWSER_EMAIL;
  const password = process.env.PRODUCT_STUDIO_BROWSER_PASSWORD;
  return email === undefined || password === undefined ? undefined : { email, password };
};

const expectSessionLifetime = async (page: Page, expectedSeconds: number): Promise<void> => {
  const cookie = (await page.context().cookies()).find(({ name }) => name.endsWith("-token"));
  expect(cookie, "Payload auth cookie was not issued.").toBeDefined();
  expect(cookie?.httpOnly).toBe(true);
  const remainingSeconds = (cookie?.expires ?? 0) - Date.now() / 1_000;
  expect(remainingSeconds).toBeGreaterThan(expectedSeconds - 60);
  expect(remainingSeconds).toBeLessThan(expectedSeconds + 60);
};

const signIn = async (
  page: Page,
  user: { email: string; password: string },
  remember: boolean,
): Promise<void> => {
  await page.getByRole("textbox", { name: "Email *" }).fill(user.email);
  await page.getByRole("textbox", { name: "Password" }).fill(user.password);
  const rememberCheckbox = page.getByRole("checkbox", { name: "Remember me" });
  await expect(rememberCheckbox).not.toBeChecked();
  if (remember) await rememberCheckbox.check();
  await page.getByRole("button", { name: "Login" }).click();
};

test.beforeAll(() => {
  if (process.env.PRODUCT_STUDIO_BROWSER_BASE_URL === undefined)
    throw new Error("PRODUCT_STUDIO_BROWSER_BASE_URL is required for browser verification.");
});

test("unauthenticated users reach sign-in with the Product Map return target", async ({ page }) => {
  const returnPath = "/admin/product-map?entity=00000000-0000-4000-8000-000000000302&q=Content";

  await page.goto(returnPath);
  await expect(page).toHaveURL(/\/admin\/login\?/);

  const current = new URL(page.url());
  expect(current.searchParams.get("redirect")).toBe(returnPath);
  await expect(page.getByRole("textbox", { name: "Email *" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Remember me" })).not.toBeChecked();
  await expect(page.getByText("Keep me signed in on this device for 365 days.")).toBeVisible();
});

test("ordinary login retains the configured session lifetime", async ({ page }) => {
  const user = credentials();
  test.skip(user === undefined, "Browser credentials were not supplied.");

  await page.goto("/admin/account");
  await signIn(page, user ?? { email: "", password: "" }, false);

  await expect(page).toHaveURL(/\/admin\/account(?:\?|$)/);
  await expectSessionLifetime(page, configuredSessionSeconds);
});

test("authenticated users can drill through the visual capability constellation", async ({
  page,
}) => {
  const user = credentials();
  test.skip(user === undefined, "Browser credentials were not supplied.");

  await page.goto("/admin/product-map");
  await signIn(page, user ?? { email: "", password: "" }, false);

  await expect(page).toHaveURL(/\/admin\/product-map(?:\?|$)/);
  await expect(
    page.getByRole("heading", { name: "Product Capability Graph", level: 1 }),
  ).toBeVisible();

  const explorer = page.getByTestId("product-capability-explorer");
  await expect(explorer).toBeVisible();
  await expect(explorer).toHaveAttribute("data-renderer", "3d-force-graph");
  await expect(page.getByTestId("product-capability-graph").locator("canvas")).toBeVisible();
  const initialDepth = await explorer.getAttribute("data-depth");
  await explorer.getByText("Text navigator", { exact: true }).click();
  const firstChild = explorer
    .locator('[data-testid="capability-text-node"][data-role="child"] button')
    .first();
  await expect(firstChild).toBeVisible();
  await firstChild.click();
  await expect(explorer).not.toHaveAttribute("data-depth", initialDepth ?? "0");
  await expect(page.getByRole("button", { name: "Back one level" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Relationships on/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Product-owner review queue")).toHaveCount(0);

  const screenshotPath = process.env.PRODUCT_STUDIO_BROWSER_SCREENSHOT_PATH;
  if (screenshotPath !== undefined) {
    await explorer.getByText("Text navigator", { exact: true }).click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: screenshotPath });
  }
});

test("Remember me creates a 365-day session while preserving redirect and logout", async ({
  page,
}) => {
  const user = credentials();
  test.skip(user === undefined, "Browser credentials were not supplied.");
  const returnPath = "/admin/product-map?entity=00000000-0000-4000-8000-000000000302";

  await page.goto(returnPath);
  await signIn(page, user ?? { email: "", password: "" }, true);

  await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === returnPath);
  await expectSessionLifetime(page, rememberedSessionSeconds);

  const logoutResponse = await page.request.post("/api/studio-users/logout");
  expect(logoutResponse.ok()).toBe(true);
  await page.goto(returnPath);
  await expect(page).toHaveURL(/\/admin\/login\?/);
});
