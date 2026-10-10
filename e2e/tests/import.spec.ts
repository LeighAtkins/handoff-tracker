import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { reseed } from "../global-setup";

test.beforeEach(() => reseed());

const fixture = fileURLToPath(new URL("../fixtures/orders-48-good-2-bad.csv", import.meta.url));

test("an operator imports a CSV: 48 rows imported, 2 reported", async ({ page }) => {
  await page.goto("/import");
  await page.getByLabel("CSV file").setInputFiles(fixture);
  await page.getByRole("button", { name: "Upload and preview" }).click();

  const preview = page.getByTestId("import-preview");
  await expect(preview).toContainText("48 valid rows");
  await expect(preview).toContainText("2 rows with errors");
  const errors = page.getByTestId("import-errors");
  await expect(errors).toContainText("row 14: missing tracking number");
  await expect(errors).toContainText("row 37: country must be a 2-letter code like JP");

  await page.getByRole("button", { name: "Import 48 valid rows" }).click();
  await expect(page.getByTestId("import-result")).toContainText("48 rows imported, 2 rejected.");
  await expect(page.getByTestId("import-result")).toContainText(
    "48 new orders, 0 updated, 48 new shipments",
  );

  await page.goto("/shipments?q=IMP-");
  await expect(page.getByText("48 shipments")).toBeVisible();
});

test("re-importing the same file updates instead of duplicating", async ({ page }) => {
  for (const expected of [
    "48 new orders, 0 updated",
    "0 new orders, 48 updated, 0 new shipments",
  ]) {
    await page.goto("/import");
    await page.getByLabel("CSV file").setInputFiles(fixture);
    await page.getByRole("button", { name: "Upload and preview" }).click();
    await page.getByRole("button", { name: "Import 48 valid rows" }).click();
    await expect(page.getByTestId("import-result")).toContainText(expected);
  }
  await page.goto("/shipments?q=IMP-");
  await expect(page.getByText("48 shipments")).toBeVisible();
});
