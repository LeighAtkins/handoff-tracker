import { expect, test, type Page } from "@playwright/test";
import { reseed } from "../global-setup";

// These tests change data, so each starts from a fresh seed.
test.beforeEach(() => reseed());

async function openStuckShipment(page: Page, index: number) {
  await page.goto("/stuck");
  const link = page
    .getByRole("row")
    .filter({ hasText: "since handoff" })
    .nth(index)
    .getByRole("link");
  const orderNumber = await link.innerText();
  await link.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(orderNumber);
  return orderNumber;
}

test("an operator adds a manual event and sees it in the timeline and audit log", async ({
  page,
}) => {
  await openStuckShipment(page, 0);

  const form = page.getByTestId("manual-event");
  await form.getByLabel("Leg").selectOption({ index: 1 });
  await form
    .getByLabel("What the carrier says")
    .fill("Phoned Sagawa: parcel is at the Osaka depot");
  await form.getByLabel("Location (optional)").fill("Osaka");
  await form.getByLabel("Means").selectOption("IN_TRANSIT");
  await form.getByRole("button", { name: "Add event" }).click();
  await expect(form.getByRole("status")).toHaveText("Event added");

  const leg2 = page.getByRole("region", { name: "Leg 2" });
  await expect(leg2).toContainText("Phoned Sagawa: parcel is at the Osaka depot");
  await expect(leg2).toContainText("entered manually");
  // Sagawa has now reported, so the shipment is no longer quiet after its handoff.
  await expect(page.getByText("STUCK", { exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "Audit" }).click();
  await expect(page.getByRole("row").filter({ hasText: "MANUAL_EVENT_ADDED" })).toContainText(
    "operator@example.com",
  );
});

test("an operator marks a stuck shipment resolved", async ({ page }) => {
  const orderNumber = await openStuckShipment(page, 0);

  await page.getByTestId("mark-resolved").getByRole("button", { name: "Mark resolved" }).click();
  await expect(page.getByText("STUCK", { exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "Audit" }).click();
  await expect(page.getByRole("row").filter({ hasText: "STUCK_RESOLVED" })).toBeVisible();

  await page.goto("/stuck");
  await expect(page.getByRole("link", { name: orderNumber })).toHaveCount(0);
});

test("an override needs a reason", async ({ page }) => {
  await openStuckShipment(page, 0);
  const form = page.getByTestId("override");
  await form.getByLabel("Status").selectOption("DELIVERED");
  await form.getByLabel("Reason (required)").fill("Customer emailed a photo of the parcel");
  await form.getByRole("button", { name: "Override" }).click();
  await expect(page.getByText(/Status manually set to DELIVERED/)).toBeVisible();
});
