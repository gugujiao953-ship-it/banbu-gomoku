export const openTreeInspector = async (dialog) => {
  const toggle = dialog.getByRole("button", { name: "节点操作", exact: true });
  if (await toggle.isVisible() && await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  await dialog.locator(".tree-node-actions").waitFor({ state: "visible" });
  // The grid measures its newly visible width in an effect and a follow-up frame.
  await dialog.locator(".tree-node-action-grid").evaluate((element) => new Promise((resolve) => {
    let previous = "", stable = 0;
    const tick = () => {
      const next = getComputedStyle(element).gridTemplateColumns;
      stable = next === previous ? stable + 1 : 0;
      previous = next;
      if (stable >= 4) resolve(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
};

export const chooseTreeZoom = async (dialog, label) => {
  await dialog.getByLabel("选择缩放比例", { exact: true }).click();
  await dialog.locator(".tree-zoom-presets").getByRole("button", { name: label, exact: true }).click();
};
