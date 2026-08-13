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

const openAuthenticatedMap = async (page: Page, path = "/admin/product-map") => {
  const user = credentials();
  test.skip(user === undefined, "Browser credentials were not supplied.");
  await page.goto(path);
  const explorer = page.getByTestId("product-capability-explorer");
  const email = page.getByRole("textbox", { name: "Email *" });
  await expect(explorer.or(email)).toBeVisible();
  if (await email.isVisible()) await signIn(page, user ?? { email: "", password: "" }, false);
  await expect(page).toHaveURL(/\/admin\/product-map(?:\?|$)/);
  await expect(explorer).toBeVisible();
  return explorer;
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
  const graphLoadStartedAt = performance.now();
  const explorer = await openAuthenticatedMap(page);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const serverErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => failedRequests.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  });
  await expect(
    page.getByRole("heading", { name: "Product capability explorer", level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId("product-model-tree")).toBeVisible();
  await expect(page.getByTestId("contextual-inspector")).toBeVisible();
  await expect(explorer).toHaveAttribute("data-renderer", "3d-force-graph");
  const graph = page.getByTestId("product-capability-graph");
  await expect(graph.locator("canvas")).toBeVisible();
  const graphLoadDurationMs = performance.now() - graphLoadStartedAt;
  expect(graphLoadDurationMs).toBeLessThan(15_000);

  const initialDepth = await explorer.getAttribute("data-depth");
  const initialSceneSignature = await graph.getAttribute("data-scene-signature");
  const tree = page.getByTestId("product-model-tree");
  const child = tree.getByTestId("product-tree-node").nth(1);
  const childId = await child.getAttribute("data-entity-id");
  expect(childId).not.toBeNull();

  const selectionStartedAt = performance.now();
  await child.locator(':scope > div > [data-testid="product-tree-select"]').click();
  await expect(explorer).toHaveAttribute("data-selected-entity", childId ?? "");
  expect(performance.now() - selectionStartedAt).toBeLessThan(5_000);
  await expect(explorer).toHaveAttribute("data-depth", initialDepth ?? "0");
  await expect(graph).toHaveAttribute("data-scene-signature", initialSceneSignature ?? "");
  await expect(page).toHaveURL((url) => url.searchParams.get("selected") === childId);

  await tree.getByRole("button", { name: "Zoom to selected" }).click();
  await expect(explorer).not.toHaveAttribute("data-depth", initialDepth ?? "0");
  await expect(page).toHaveURL((url) => url.searchParams.get("focus") === childId);

  await page.goBack();
  await expect(explorer).toHaveAttribute("data-depth", initialDepth ?? "0");
  await page.goForward();
  await expect(explorer).toHaveAttribute("data-selected-entity", childId ?? "");

  await page.getByRole("button", { name: "Open full dossier" }).click();
  const dossier = page.getByTestId("full-dossier");
  await expect(dossier).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await dossier.getByRole("button", { name: "delivery", exact: true }).click();
  await expect(dossier.getByRole("heading", { name: "Delivery stages" })).toBeVisible();
  await expect(dossier.getByText("deployed", { exact: true })).toBeVisible();
  await expect(dossier.getByText("verified", { exact: true })).toBeVisible();
  await expect(dossier.getByText("accepted", { exact: true })).toBeVisible();
  await dossier.getByRole("button", { name: "history", exact: true }).click();
  await expect(dossier.getByRole("heading", { name: "Identity evolution" })).toBeVisible();
  await dossier.getByRole("button", { name: "View current revision" }).click();
  await expect(dossier).toBeHidden();
  await expect(explorer).toHaveAttribute("data-lens", "history");
  await expect(explorer).toHaveAttribute("data-view", "revision-diff");
  await expect(page.getByRole("heading", { name: "revision diff" })).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(serverErrors).toEqual([]);
});

test("the digital twin workspace teaches through synchronized explain, tour, and delivery modes", async ({
  page,
}) => {
  const explorer = await openAuthenticatedMap(page);
  const tree = page.getByTestId("product-model-tree");
  const model = page.getByRole("region", { name: "Product model" });
  const inspector = page.getByTestId("contextual-inspector");
  await expect(tree).toBeVisible();
  await expect(model).toBeVisible();
  await expect(inspector).toBeVisible();
  const graph = page.getByTestId("product-capability-graph");
  await expect(graph).toHaveAttribute("data-render-state", "ready", { timeout: 12_000 });

  const [treeBox, modelBox, inspectorBox] = await Promise.all([
    tree.boundingBox(),
    model.boundingBox(),
    inspector.boundingBox(),
  ]);
  expect(treeBox).not.toBeNull();
  expect(modelBox).not.toBeNull();
  expect(inspectorBox).not.toBeNull();
  expect((treeBox?.x ?? 0) + (treeBox?.width ?? 0)).toBeLessThanOrEqual((modelBox?.x ?? 0) + 1);
  expect((modelBox?.x ?? 0) + (modelBox?.width ?? 0)).toBeLessThanOrEqual(
    (inspectorBox?.x ?? 0) + 1,
  );
  const reviewArtifactDirectory = process.env.PRODUCT_STUDIO_BROWSER_REVIEW_ARTIFACT_DIRECTORY;
  if (reviewArtifactDirectory !== undefined) {
    await page.waitForTimeout(750);
    await page.screenshot({
      animations: "disabled",
      path: `${reviewArtifactDirectory}/product-digital-twin-desktop.png`,
    });
  }

  await page.getByRole("button", { name: "explain", exact: true }).click();
  await expect(explorer).toHaveAttribute("data-learning-mode", "explain");
  await expect(page.getByTestId("explain-panel")).toContainText("Explain this capability");

  await page.getByRole("button", { name: "tour", exact: true }).click();
  await expect(explorer).toHaveAttribute("data-learning-mode", "tour");
  const tour = page.getByTestId("guided-tour");
  await expect(tour).toContainText("Product orientation");
  const firstSelection = await explorer.getAttribute("data-selected-entity");
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(explorer).not.toHaveAttribute("data-selected-entity", firstSelection ?? "");
  await tour.getByRole("button", { name: "Exit tour" }).click();
  await expect(explorer).toHaveAttribute("data-learning-mode", "explore");

  const currentInspector = page.getByTestId("contextual-inspector");
  await currentInspector.getByRole("tab", { name: "Delivery" }).click();
  await expect(currentInspector.getByText("Active sprint", { exact: true })).toBeVisible();
  await expect(currentInspector.getByText(/Q[1-4] relevance/)).toBeVisible();
  await expect(
    currentInspector.getByText(
      "Deployment, compatibility, verification, and acceptance are never collapsed.",
    ),
  ).toBeVisible();
});

test("typed edges, lenses, compare, and path commands stay synchronized", async ({ page }) => {
  const explorer = await openAuthenticatedMap(page);
  const inspector = page.getByTestId("contextual-inspector");
  await inspector.getByRole("tab", { name: /Relations/ }).click();
  const relationButton = inspector.getByTestId("inspector-relation").first();
  await expect(relationButton).toBeVisible();
  await relationButton.click();
  await expect(explorer).toHaveAttribute("data-selected-relation", /.+/);
  await expect(page.getByText("Selected relationship", { exact: true })).toBeVisible();
  await expect(page.getByText("Provenance class", { exact: true })).toBeVisible();
  await expect(page.getByText("Audience-safe scope", { exact: true })).toBeVisible();
  await expect(page.getByText("Variant qualifiers", { exact: true })).toBeVisible();
  await expect(page.getByText("Supporting evidence coverage", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Related authorized delivery context", { exact: true }),
  ).toBeVisible();

  await page.getByLabel("Visual lens").selectOption("relationships");
  await expect(explorer).toHaveAttribute("data-lens", "relationships");
  await expect(explorer).toHaveAttribute("data-view", "graph");

  const tree = page.getByTestId("product-model-tree");
  const entityNodes = tree.getByTestId("product-tree-node");
  await entityNodes.nth(0).locator(':scope > div > [data-testid="product-tree-select"]').click();
  await tree.getByRole("button", { name: "Add to comparison" }).click();
  await entityNodes.nth(1).locator(':scope > div > [data-testid="product-tree-select"]').click();
  await tree.getByRole("button", { name: "Add to comparison" }).click();
  await expect(explorer).toHaveAttribute("data-compare-count", "2");
  await page.getByText("Analysis tools", { exact: true }).click();
  const findPath = page.getByRole("button", { name: "Find path (2/2)" });
  await expect(findPath).toBeEnabled();
  await findPath.click();

  await page.getByLabel("Visual lens").selectOption("dependencies");
  await expect(explorer).toHaveAttribute("data-lens", "dependencies");
  await expect(explorer).toHaveAttribute("data-view", "matrix");
  await expect(page.getByRole("heading", { name: "matrix" })).toBeVisible();
  await page.getByRole("button", { name: "Downstream impact" }).click();
  await page.getByRole("button", { name: "Prerequisites" }).click();

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

  const reviewArtifactDirectory = process.env.PRODUCT_STUDIO_BROWSER_REVIEW_ARTIFACT_DIRECTORY;
  if (reviewArtifactDirectory !== undefined)
    await page.screenshot({
      animations: "disabled",
      path: `${reviewArtifactDirectory}/product-digital-twin-tablet.png`,
    });

  const accessibleNode = page
    .getByTestId("product-model-tree")
    .getByTestId("product-tree-select")
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
  const node = page.getByTestId("product-model-tree").getByTestId("product-tree-select").first();
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
