import { expect, test as setup } from "@playwright/test";

import { OPERATOR_STATE, VIEWER_STATE } from "../auth-states";

for (const [email, path] of [
  ["operator@example.com", OPERATOR_STATE],
  ["viewer@example.com", VIEWER_STATE],
] as const) {
  setup(`sign in as ${email}`, async ({ page }) => {
    await page.goto("/signin");
    await page.getByTestId("dev-login").getByLabel("User").selectOption(email);
    await page.getByRole("button", { name: "Sign in as this user" }).click();
    await expect(page.getByText(email)).toBeVisible();
    await page.context().storageState({ path });
  });
}
