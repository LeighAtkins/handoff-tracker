import { expect, test } from "@playwright/test";

test("the metrics page shows the trial numbers and states its assumption", async ({ page }) => {
  await page.goto("/metrics?days=7");
  await expect(page.getByRole("heading", { name: "Trial metrics" })).toBeVisible();
  const metrics = page.getByTestId("metrics");
  await expect(metrics).toContainText("Shipments tracked");
  await expect(metrics).toContainText("Stuck shipments surfaced");
  await expect(page.getByText("How “minutes saved” is estimated")).toBeVisible();
});
