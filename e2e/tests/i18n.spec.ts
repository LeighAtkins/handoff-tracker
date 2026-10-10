import { expect, test } from "@playwright/test";

test("staff can switch the main screens to Japanese and back", async ({ page }) => {
  await page.goto("/stuck");
  await page.getByRole("button", { name: "日本語" }).click();
  await expect(page.getByRole("heading", { name: "停滞している出荷" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");

  await page.getByRole("link", { name: "出荷一覧" }).click();
  await expect(page.getByRole("heading", { name: "出荷一覧" })).toBeVisible();
  await expect(page.getByRole("button", { name: "絞り込み" })).toBeVisible();

  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Shipments" })).toBeVisible();
});
