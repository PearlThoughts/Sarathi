import { expect, type Locator, type Page, test } from "@playwright/test";

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

const openAuthenticatedMap = async (page: Page, path = "/admin/product-map") => {
  const user = credentials();
  test.skip(user === undefined, "Browser credentials were not supplied.");
  await page.goto(path);
  if (/\/admin\/login(?:\?|$)/.test(page.url()))
    await signIn(page, user ?? { email: "", password: "" }, false);
  await expect(page).toHaveURL(/\/admin\/product-map(?:\?|$)/);
  const explorer = page.getByTestId("product-capability-explorer");
  await expect(explorer).toBeVisible();
  return explorer;
};

const openTextNavigator = async (page: Page): Promise<Locator> => {
  const summary = page.getByText("Text navigator", { exact: true });
  const details = summary.locator("xpath=..");
  if ((await details.getAttribute("open")) === null) await summary.click();
  return details;
};

test.beforeAll(() => {
  if (process.env.PRODUCT_STUDIO_BROWSER_BASE_URL === undefined)
    throw new Error("PRODUCT_STUDIO_BROWSER_BASE_URL is required for browser verification.");
});

test("unauthenticated requests preserve the return target and reveal no product data", async ({
  page,
}) => {
  const returnPath = "/admin/product-map?entity=00000000-0000-4000-8000-000000000302&q=Capability";

  const response = await page.request.get(
    "/studio-api/product-model?resource=dossier&entityId=00000000-0000-4000-8000-000000000302",
  );
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({
    error: { code: "PRODUCT_STUDIO_AUTH_REQUIRED", message: "Sign in required." },
  });

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

test("selection, exploration, history, and browser navigation preserve the graph scene", async ({
  page,
}) => {
  const explorer = await openAuthenticatedMap(page);
  await expect(
    page.getByRole("heading", { name: "Product Capability Graph", level: 1 }),
  ).toBeVisible();
  await expect(explorer).toHaveAttribute("data-renderer", "3d-force-graph");
  await expect(page.getByTestId("product-capability-graph").locator("canvas")).toBeVisible();

  const initialDepth = await explorer.getAttribute("data-depth");
  const navigator = await openTextNavigator(page);
  const child = navigator
    .locator('[data-testid="capability-text-node"][data-role="child"]')
    .first();
  const childId = await child.getAttribute("data-entity-id");
  expect(childId).not.toBeNull();

  await child.locator("button").first().click();
  await expect(explorer).toHaveAttribute("data-selected-entity", childId ?? "");
  await expect(explorer).toHaveAttribute("data-depth", initialDepth ?? "0");
  await expect(page).toHaveURL((url) => url.searchParams.get("selected") === childId);

  await child.getByRole("button", { name: /^Explore / }).click();
  await expect(explorer).not.toHaveAttribute("data-depth", initialDepth ?? "0");
  await expect(page).toHaveURL((url) => url.searchParams.get("focus") === childId);

  await page.goBack();
  await expect(explorer).toHaveAttribute("data-depth", initialDepth ?? "0");
  await page.goForward();
  await expect(explorer).toHaveAttribute("data-selected-entity", childId ?? "");

  await page.getByRole("button", { name: "Full dossier" }).click();
  const dossier = page.getByRole("dialog", { name: /Governed entity dossier|./ });
  await expect(dossier).toBeVisible();
  await dossier.getByRole("button", { name: "Delivery", exact: true }).click();
  await expect(dossier.getByRole("heading", { name: "Delivery stages" })).toBeVisible();
  await expect(dossier.getByText("deployed", { exact: true })).toBeVisible();
  await expect(dossier.getByText("verified", { exact: true })).toBeVisible();
  await expect(dossier.getByText("accepted", { exact: true })).toBeVisible();
  await dossier.getByRole("button", { name: "History", exact: true }).click();
  await expect(dossier.getByRole("heading", { name: "Identity evolution" })).toBeVisible();
  await dossier.getByRole("button", { name: "View current revision" }).click();
  await expect(dossier).toBeHidden();
  await expect(explorer).toHaveAttribute("data-lens", "history");
  await expect(explorer).toHaveAttribute("data-view", "revision-diff");
  await expect(page.getByRole("heading", { name: "revision diff" })).toBeVisible();
});

test("typed edges, lenses, compare, and path commands stay synchronized", async ({ page }) => {
  const explorer = await openAuthenticatedMap(page);
  const navigator = await openTextNavigator(page);
  const relationButton = navigator.getByTestId("capability-text-relation").first();
  await expect(relationButton).toBeVisible();
  await relationButton.click();
  await expect(explorer).toHaveAttribute("data-selected-relation", /.+/);
  await expect(page.getByText("Selected relationship", { exact: true })).toBeVisible();

  await page.getByLabel("Visual lens").selectOption("relationships");
  await expect(explorer).toHaveAttribute("data-lens", "relationships");
  await expect(explorer).toHaveAttribute("data-view", "graph");

  const entityNodes = navigator.getByTestId("capability-text-node");
  await entityNodes
    .nth(0)
    .getByRole("button", { name: /comparison$/ })
    .click();
  await entityNodes
    .nth(1)
    .getByRole("button", { name: /comparison$/ })
    .click();
  await expect(explorer).toHaveAttribute("data-compare-count", "2");
  const findPath = page.getByRole("button", { name: "Find path (2/2)" });
  await expect(findPath).toBeEnabled();
  await findPath.click();

  await page.getByLabel("Visual lens").selectOption("dependencies");
  await expect(explorer).toHaveAttribute("data-lens", "dependencies");
  await expect(explorer).toHaveAttribute("data-view", "matrix");
  await expect(page.getByRole("heading", { name: "matrix" })).toBeVisible();
  await page.getByRole("button", { name: "Show impact" }).click();
  await page.getByRole("button", { name: "Show prerequisites" }).click();

  await page.getByLabel("Visual lens").selectOption("delivery");
  await expect(explorer).toHaveAttribute("data-view", "timeline");
  await expect(page.getByRole("heading", { name: "timeline" })).toBeVisible();
  await page.getByLabel("Synchronized view").selectOption("list");
  await expect(page.getByRole("heading", { name: "list" })).toBeVisible();
});

test("the keyboard and tablet hierarchy remain operational without relying on WebGL", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const explorer = await openAuthenticatedMap(page, "/admin/product-map?view=hierarchy");
  await expect(explorer).toHaveAttribute("data-reduced-motion", "true");
  await expect(explorer).toHaveAttribute("data-view", "hierarchy");
  await expect(page.getByTestId("product-capability-graph")).toHaveCount(0);
  const hierarchy = page.getByRole("region", { name: "hierarchy view" });
  await expect(hierarchy).toBeVisible();
  const firstEntity = hierarchy.getByRole("button").first();
  await firstEntity.focus();
  await page.keyboard.press("Enter");
  await expect(explorer).toHaveAttribute("data-selected-entity", /.+/);

  const navigator = await openTextNavigator(page);
  const accessibleNode = navigator
    .getByTestId("capability-text-node")
    .first()
    .locator("button")
    .first();
  await accessibleNode.focus();
  await page.keyboard.press("Enter");
  await expect(accessibleNode).toHaveAttribute("aria-current", "true");
});

test("WebGL failure leaves an operational structured navigator", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...options) {
      if (String(type).includes("webgl")) return null;
      return original.call(this, type, ...options);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  const explorer = await openAuthenticatedMap(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "The 3D renderer could not start" }),
  ).toBeVisible();
  const navigator = await openTextNavigator(page);
  const node = navigator.getByTestId("capability-text-node").first().locator("button").first();
  await node.focus();
  await page.keyboard.press("Enter");
  await expect(explorer).toHaveAttribute("data-selected-entity", /.+/);
});

test("wrong-audience detail failures remain privacy-safe", async ({ page }) => {
  await page.route(/\/studio-api\/product-model\?resource=dossier&/, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        error: { code: "AUDIENCE_DENIED", message: "synthetic-hidden-evidence-body" },
      }),
      contentType: "application/json",
      status: 403,
    });
  });
  await openAuthenticatedMap(page);
  await expect(
    page.getByText("The selected entity details are no longer available to this session."),
  ).toBeVisible();
  await expect(page.getByText("synthetic-hidden-evidence-body")).toHaveCount(0);
});

test("Remember me creates a 365-day session while preserving redirect and logout", async ({
  page,
}) => {
  const user = credentials();
  test.skip(user === undefined, "Browser credentials were not supplied.");
  const returnPath = "/admin/product-map?view=list";

  await page.goto(returnPath);
  await signIn(page, user ?? { email: "", password: "" }, true);

  await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === returnPath);
  await expectSessionLifetime(page, rememberedSessionSeconds);

  const logoutResponse = await page.request.post("/api/studio-users/logout");
  expect(logoutResponse.ok()).toBe(true);
  await page.goto(returnPath);
  await expect(page).toHaveURL(/\/admin\/login\?/);
});
