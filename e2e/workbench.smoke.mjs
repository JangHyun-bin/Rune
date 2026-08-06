const waitForWindowCount = async (count) => {
  await browser.waitUntil(async () => (await browser.getWindowHandles()).length === count, {
    timeout: 15_000,
    timeoutMsg: `Expected ${count} native Rune window(s)`,
  });
  return browser.getWindowHandles();
};

const mainHandle = async () => {
  for (const handle of await browser.getWindowHandles()) {
    await browser.switchToWindow(handle);
    if (await $("#editor").isExisting()) return handle;
  }
  throw new Error("Rune main window was not found");
};

const acceptFirstRunLanguage = async () => {
  const option = await $(".lang-picker-opt");
  if (await option.isExisting()) {
    await option.click();
    await $(".lang-picker-backdrop").waitForDisplayed({ reverse: true });
  }
};

const resetDetachedViews = async () => {
  await browser.pause(1_500);
  while ((await browser.getWindowHandles()).length > 1) {
    const initialCount = (await browser.getWindowHandles()).length;
    let redocked = false;
    for (const handle of await browser.getWindowHandles()) {
      await browser.switchToWindow(handle);
      const button = await $(".detached-view-redock");
      if (await button.isExisting()) {
        await button.click();
        redocked = true;
        break;
      }
    }
    if (!redocked) throw new Error("Unexpected native window could not be re-docked");
    await waitForWindowCount(initialCount - 1);
  }
};

const tearOffOutline = async () => {
  const more = await $('.workbench-view[data-view-id="outline"] .view-more');
  await more.waitForClickable();
  await more.click();
  const firstAction = await $(".ctx-menu .ctx-item");
  await firstAction.waitForClickable();
  await firstAction.click();
  return waitForWindowCount(2);
};

describe("native Workbench release smoke", () => {
  it("preserves a dirty editor while tearing off and persists the detached layout", async () => {
    await acceptFirstRunLanguage();
    await resetDetachedViews();
    const main = await mainHandle();
    await browser.switchToWindow(main);
    const editor = await $('.cm-content[contenteditable="true"]');
    await editor.waitForDisplayed();
    await editor.setValue("RC dirty buffer sentinel");
    expect(await editor.getText()).toContain("RC dirty buffer sentinel");

    const handles = await tearOffOutline();
    const detachedHandle = handles.find((handle) => handle !== main);
    expect(detachedHandle).toBeTruthy();
    await browser.switchToWindow(detachedHandle);
    await $(".detached-view-redock").waitForDisplayed();
    await browser.switchToWindow(main);
    expect(await $('.cm-content[contenteditable="true"]').getText()).toContain("RC dirty buffer sentinel");
    await browser.pause(1_500);
  });
});
