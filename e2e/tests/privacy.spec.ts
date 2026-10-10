import { expect, test } from "@playwright/test";

test("customer details are masked until revealed, and revealing is audited", async ({ page }) => {
  await page.goto("/shipments?q=DEMO-10001");
  await page.getByRole("link", { name: "DEMO-10001" }).click();

  const name = page.getByTestId("customer-name");
  await expect(name).toContainText("•");
  // The full name is not anywhere in the page until someone asks for it.
  const html = await page.content();
  const masked = (await name.innerText()).replace("reveal", "").trim();
  expect(masked).toMatch(/^\S•+ \S•+$/);
  expect(html).not.toMatch(
    /(Aiko|Kenji|Yui|Haruto|Mei|Sota|Rin|Daiki|Sakura|Ren) (Tanaka|Suzuki|Sato|Takahashi|Watanabe|Ito|Nakamura|Kobayashi)/,
  );

  await name.getByRole("button", { name: "reveal" }).click();
  await expect(name).not.toContainText("•");

  await page.getByRole("link", { name: "Audit" }).click();
  await expect(page.getByRole("row").filter({ hasText: "CUSTOMER_REVEALED" })).toContainText(
    "operator@example.com",
  );
});
