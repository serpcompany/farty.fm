import { expect, test } from "@playwright/test";

test("screen nav stays sticky and can scroll to lower screen entries", async ({ page }) => {
  await page.goto("/");

  const sidebar = page.getByTestId("screen-nav");
  await expect(sidebar).toBeVisible();

  const topBefore = await sidebar.evaluate((element) => element.getBoundingClientRect().top);
  await page.mouse.wheel(0, 1200);
  const topAfter = await sidebar.evaluate((element) => element.getBoundingClientRect().top);

  expect(Math.abs(topBefore - topAfter)).toBeLessThan(2);

  await sidebar.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  await expect(
    sidebar.getByRole("button", { name: "38. Generated Song Result" }),
  ).toBeVisible();
});

test("bottom nav stays visible on quick record and includes AI Song Creator", async ({
  page,
}) => {
  await page.goto("/");
  const phone = page.getByTestId("iphone-screen");

  await page.getByRole("button", { name: "7. Siri / App Shortcut Trigger" }).click();
  await expect(phone.getByText("Fastest clean iPhone record flow")).toBeVisible();
  const bottomNav = phone.getByTestId("bottom-nav");
  await expect(bottomNav.getByRole("button", { name: "AI Song Creator" })).toBeVisible();
  await expect(bottomNav.getByRole("button", { name: "Home" })).toBeVisible();

  await bottomNav.getByRole("button", { name: "AI Song Creator" }).click();
  await expect(phone.getByText("Turn saved farts into a song.")).toBeVisible();
});

test("quick record shortcut flow reaches the active recording state", async ({ page }) => {
  await page.goto("/");
  const phone = page.getByTestId("iphone-screen");

  await expect(page.getByRole("heading", { name: "Pedos Wireframes" })).toBeVisible();

  await page.getByRole("button", { name: "7. Siri / App Shortcut Trigger" }).click();
  await expect(phone.getByText("Fastest clean iPhone record flow")).toBeVisible();
  await expect(phone.getByRole("button", { name: /Siri phrase/i })).toBeVisible();

  await phone.getByRole("button", { name: "Simulate quick record" }).click();
  await expect(phone.getByText("Recording started immediately")).toBeVisible();
  await expect(phone.getByText("00:03.2")).toBeVisible();
});

test("Pedos AI flow covers smart choose, cover input, and result", async ({ page }) => {
  await page.goto("/");
  const phone = page.getByTestId("iphone-screen");

  await page.getByRole("button", { name: "30. Pedos AI Home" }).click();
  await expect(phone.getByText("Turn saved farts into a song.")).toBeVisible();

  await phone.getByRole("button", { name: "Start song flow" }).click();
  await expect(phone.getByText("Choose the fart clips to use.")).toBeVisible();

  await phone.getByRole("button", { name: /AI smart choose/i }).click();
  await expect(phone.getByText("AI picked the clips below.")).toBeVisible();

  await phone.getByRole("button", { name: "Use these clips" }).click();
  await expect(phone.getByText("Choose the kind of song to generate.")).toBeVisible();

  await phone.getByRole("button", { name: /Cover-style concept/i }).click();
  await expect(phone.getByText("Add the artist or song reference.")).toBeVisible();

  await phone.getByRole("button", { name: "Generate cover-style song" }).click();
  await expect(phone.getByText("Pedos AI is making the track.")).toBeVisible();

  await phone.getByRole("button", { name: "View result" }).click();
  await expect(phone.getByText("Funk of the Fallen Thunder")).toBeVisible();
  await expect(phone.getByRole("button", { name: "Play generated song" })).toBeVisible();
});
