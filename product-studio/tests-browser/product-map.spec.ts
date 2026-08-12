import { expect, test } from "@playwright/test";

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
});

test("authenticated users can drill through the visual capability constellation", async ({
  page,
}) => {
  const email = process.env.PRODUCT_STUDIO_BROWSER_EMAIL;
  const password = process.env.PRODUCT_STUDIO_BROWSER_PASSWORD;
  test.skip(
    email === undefined || password === undefined,
    "Browser credentials were not supplied.",
  );

  await page.goto("/admin/product-map");
  await page.getByRole("textbox", { name: "Email *" }).fill(email ?? "");
  await page.getByRole("textbox", { name: "Password" }).fill(password ?? "");
  await page.getByRole("button", { name: "Login" }).click();

  await expect(page).toHaveURL(/\/admin\/product-map(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Product Map", level: 1 })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Capability Constellation", level: 2 }),
  ).toBeVisible();

  const explorer = page.getByTestId("product-capability-explorer");
  await expect(explorer).toBeVisible();
  const initialDepth = await explorer.getAttribute("data-depth");
  const firstChild = explorer
    .locator('[data-testid="capability-cloud-node"][data-role="child"] button')
    .first();
  await expect(firstChild).toBeVisible();
  await firstChild.click();
  await expect(explorer).not.toHaveAttribute("data-depth", initialDepth ?? "0");
  await expect(page.getByRole("button", { name: "Back one level" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Relationships on/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Product-owner review queue")).toBeVisible();
});
