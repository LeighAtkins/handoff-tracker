import { expect, test } from "@playwright/test";
import { VIEWER_STATE } from "../auth-states";

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("is sent to the sign-in page", async ({ page }) => {
    await page.goto("/shipments");
    await expect(page).toHaveURL(/\/signin$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});

test.describe("viewer", () => {
  test.use({ storageState: VIEWER_STATE });

  test("can look but not change anything", async ({ page }) => {
    await page.goto("/stuck");
    await page
      .getByRole("row")
      .filter({ hasText: "since handoff" })
      .first()
      .getByRole("link")
      .click();
    await expect(page.getByText("You have read-only access")).toBeVisible();
    await expect(page.getByTestId("manual-event")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Import" })).toHaveCount(0);
  });
});
