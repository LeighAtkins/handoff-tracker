import { expect, test } from "@playwright/test";

test("an operator prints a packing slip and a label, and both are audited", async ({ page }) => {
  await page.goto("/shipments?q=DEMO-10030");
  await page.getByRole("link", { name: "DEMO-10030" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("DEMO-10030");
  const detailUrl = page.url();

  await page.getByRole("link", { name: "Packing slip" }).click();
  const slip = page.getByTestId("slip");
  await expect(slip).toContainText("DEMO-10030");
  await expect(slip.locator("svg")).toBeVisible(); // barcode

  await page.getByRole("link", { name: "Parcel label" }).click();
  const label = page.getByTestId("label");
  await expect(label).toContainText("Deliver to");
  await expect(label.locator("svg")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  await page.goto(`${detailUrl}?tab=audit`);
  await expect(page.getByRole("row").filter({ hasText: "DOCUMENT_PRINTED" })).toHaveCount(2);
});
