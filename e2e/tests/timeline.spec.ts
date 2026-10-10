import { expect, test } from "@playwright/test";

test("a parcel quiet after handoff shows the 4PX → Sagawa handoff in its timeline", async ({
  page,
}) => {
  await page.goto("/stuck");
  const row = page.getByRole("row").filter({ hasText: "since handoff" }).first();
  await row.getByRole("link").click();

  await expect(page.getByText("STUCK", { exact: true })).toBeVisible();
  await expect(page.getByTestId("handoff-marker")).toContainText("Handoff 4PX → SAGAWA");
  await expect(page.getByRole("region", { name: "Leg 2" })).toContainText(
    "No events from SAGAWA yet",
  );
  await expect(page.getByRole("region", { name: "Leg 1" })).toContainText(
    "Handed over to last-mile carrier",
  );
});
