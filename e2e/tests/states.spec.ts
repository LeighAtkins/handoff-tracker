import { expect, test } from "@playwright/test";

// With loading boundaries the response is already streaming when notFound() runs, so Next.js
// renders the 404 page with status 200 and a noindex tag. The page itself is what staff see.
test("unknown shipments and imports get a friendly not-found page", async ({ page }) => {
  for (const path of [
    "/shipments/does-not-exist",
    "/import/does-not-exist",
    "/shipments/does-not-exist/print",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to shipments" })).toBeVisible();
  }
});
