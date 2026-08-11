const waitForWindowCount = async (count) => {
  await browser.waitUntil(async () => (await browser.getWindowHandles()).length === count, {
    timeout: 15_000,
    timeoutMsg: `Expected ${count} native Rune window(s)`,
  });
  return browser.getWindowHandles();
};

describe("native Workbench layout recovery smoke", () => {
  it("keeps the exact Panel destination and dirty editor after another restart", async () => {
    await $('html[data-wdio-ready="true"]').waitForExist();
    await $('html[data-wdio-hot-exit-recovered="true"]').waitForExist();
    await browser.execute(() => window.dispatchEvent(new Event("rune:wdio-restore-view-windows")));
    await waitForWindowCount(1);
    const workspace = await browser.execute(() => window.__RUNE_DOCKING_RELEASE_GATE__.workspace());
    const group = Object.values(workspace.workbench.viewGroups.panel.groups)
      .find((candidate) => candidate.viewIds.includes("outline"));
    expect(workspace.workbench.views.outline.containerId).toBe("panel");
    expect(group.viewIds).toEqual(["search", "outline"]);
    await $('.panel-tab[data-view-id="outline"]').waitForDisplayed();
    expect(await $('.cm-content[contenteditable="true"]').getText()).toContain("RC dirty buffer sentinel");
  });
});
