import { expect, test } from "@playwright/test";

test("the overview shows where parcels are and who needs chasing today", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  const kpis = page.getByTestId("kpis");
  await expect(kpis).toContainText("Open parcels");
  await expect(kpis).toContainText("4PX → Sagawa handoff");

  const attention = page.getByTestId("attention");
  await expect(attention).toContainText("Stuck after the handoff");
  await attention.getByRole("link").filter({ hasText: "Stuck after the handoff" }).first().click();
  await expect(page.getByTestId("insights")).toContainText("Ask Sagawa where it is");
});

test("a sample lookup explains a stalled handoff and what to do about it", async ({ page }) => {
  await page.goto("/track");
  await page
    .getByTestId("samples")
    .getByRole("link", { name: /Stuck after the handoff/ })
    .click();
  await expect(page).toHaveURL(/\/track\/4PXDEMO1002CN$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("4PXDEMO1002CN");

  const insights = page.getByTestId("insights");
  await expect(insights).toContainText("Stuck after the handoff");
  await expect(insights).toContainText("Ask Sagawa where it is (tracking number 900000101002)");
  await expect(page.getByTestId("milestones")).toContainText("Handed to Sagawa");
  // 4PX's own status code is shown next to its cryptic wording.
  await expect(page.getByText("FPX_D_STPP")).toBeVisible();
  await expect(page.getByTestId("fourpx-pitch")).toBeVisible();
});

test("a pasted number is tidied up, and nonsense is explained", async ({ page }) => {
  await page.goto("/track");
  const box = page.getByRole("main").getByRole("search").getByRole("textbox");
  await box.fill(" 4pxdemo 1001-cn ");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/track\/4PXDEMO1001CN$/);
  await expect(page.getByTestId("insights")).toContainText("Delivered in");

  await page.goto("/track?n=abc");
  await expect(page.getByText("That does not look like a tracking number")).toBeVisible();
});

test("the data sources page shows what is connected and how to get 4PX keys", async ({ page }) => {
  await page.goto("/sources");
  await expect(page.getByRole("heading", { level: 1, name: "Data sources" })).toBeVisible();
  await expect(page.getByTestId("providers")).toContainText("4PX API");
  await expect(page.getByTestId("compare")).toContainText("Sagawa's tracking number");
  await expect(page.getByText("How we get the keys")).toBeVisible();
});

test("a stuck shipment's page shows its journey and the next step", async ({ page }) => {
  await page.goto("/stuck");
  await page
    .getByRole("row")
    .filter({ hasText: "since handoff" })
    .first()
    .getByRole("link")
    .click();
  await expect(page.getByTestId("insights")).toContainText("Stuck after the handoff");
  await expect(page.getByTestId("milestones")).toContainText("Sagawa scanned it");
});
