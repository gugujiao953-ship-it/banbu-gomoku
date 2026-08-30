import { chromium } from "playwright";
import assert from "node:assert/strict";

const baseURL = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true });

async function freshPage() {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(baseURL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  return { context, page };
}

async function clickPoint(page, coordinate) {
  await page.getByRole("gridcell", { name: new RegExp(`^${coordinate}(?:空位|已有棋子|禁手)`) }).click();
}

try {
  {
    const { context, page } = await freshPage();
    await page.getByRole("button", { name: "设置" }).click();
    await page.getByText("可选增强功能", { exact: true }).click();
    await page.getByLabel("AI 棋盘提示点").check();
    await page.getByRole("button", { name: "打谱" }).click();
    await page.getByRole("button", { name: "AI" }).click();
    await page.getByRole("button", { name: /五手两打/ }).click();
    await page.getByRole("button", { name: /开始人机对战/ }).click();
    await page.getByText("第 1 手").waitFor();
    await clickPoint(page, "H8");
    await clickPoint(page, "I8");
    await clickPoint(page, "H7");
    await page.getByText(/请提供 2 个不同棋形/).waitFor({ timeout: 5000 });
    await clickPoint(page, "G8");
    assert.equal(await page.locator(".opening-candidate").count(), 1, "未选定的黑5候选应以编号临时显示");
    await page.screenshot({ path: "C:/Users/ZhuanZ(无密码)/AppData/Local/Temp/banbu-five-two-candidate.png", fullPage: true });
    await clickPoint(page, "J9");
    await page.locator(".ai-opening-banner").waitFor({ state: "detached", timeout: 7000 });
    assert.equal(await page.locator(".stone").count(), 6, "五手两打开局应只写入选中的黑5并完成第6手");
    await page.screenshot({ path: "C:/Users/ZhuanZ(无密码)/AppData/Local/Temp/banbu-five-two.png", fullPage: true });
    await context.close();
  }

  {
    const { context, page } = await freshPage();
    await page.getByRole("button", { name: "AI" }).click();
    await page.getByRole("button", { name: /塔十/ }).click();
    await page.getByRole("button", { name: /开始人机对战/ }).click();
    await clickPoint(page, "H8");
    await page.getByRole("button", { name: "不交换" }).waitFor({ timeout: 5000 });
    assert.match(await page.locator(".ai-opening-banner").innerText(), /第 2 手后可选择是否交换黑白方/);
    await page.screenshot({ path: "C:/Users/ZhuanZ(无密码)/AppData/Local/Temp/banbu-taraguchi-swap.png", fullPage: true });
    await context.close();
  }

  {
    const { context, page } = await freshPage();
    await page.getByRole("radio", { name: "黑棋" }).click();
    for (const coordinate of ["F8", "G8", "H8", "I8", "J8"]) await clickPoint(page, coordinate);
    assert.ok(await page.locator(".winning-line").count(), "连五后应显示红色胜利连线");
    assert.equal(await page.locator(".winning-stone-ring").count(), 5, "获胜五子应逐颗高亮");
    assert.equal(await page.locator(".forbidden-point").count(), 0, "对局结束后不应继续显示可落子禁手提示");
    await page.screenshot({ path: "C:/Users/ZhuanZ(无密码)/AppData/Local/Temp/banbu-winning-line.png", fullPage: true });
    await context.close();
  }

  {
    const { context, page } = await freshPage();
    await page.getByRole("button", { name: "设置" }).click();
    await page.getByText("可选增强功能", { exact: true }).click();
    await page.getByLabel("AI 棋盘提示点").check();
    await page.getByText("棋盘显示", { exact: true }).click();
    await page.getByLabel("界面动效").check();
    await page.getByRole("button", { name: "打谱" }).click();
    const thinkButton = page.getByRole("button", { name: "思考当前局面的下一步" });
    assert.equal(await thinkButton.count(), 1, "打谱工具栏缺少思考按钮");
    await thinkButton.click();
    await page.locator(".command-think.machine-thinking").waitFor({ timeout: 5000 });
    assert.equal(await page.locator(".command-think.machine-thinking").evaluate((element) => getComputedStyle(element, "::before").animationName), "ai-thinking-border-spin", "AI 思考时思考按钮应显示流光边框");
    await page.locator(".think-result").waitFor({ timeout: 20000 });
    assert.equal(await page.locator(".thinking-point").count(), 1, "AI 推荐落点没有回显到棋盘");
    assert.match(await page.locator(".think-result").innerText(), /AI 推荐落点/);
    await page.screenshot({ path: "C:/Users/ZhuanZ(无密码)/AppData/Local/Temp/banbu-think-panel.png", fullPage: true });
    await context.close();
  }

  {
    const { context, page } = await freshPage();
    await page.getByRole("button", { name: "AI" }).click();
    await page.getByRole("button", { name: /开始人机对战/ }).click();
    await clickPoint(page, "H8");
    await page.locator(".stone").nth(1).waitFor({ timeout: 30000 });
    assert.ok(await page.locator(".stone").count() >= 2, "人机对战没有完成一次 AI 回应");
    await page.getByRole("button", { name: "上一手" }).click();
    await clickPoint(page, "A1");
    assert.equal(await page.locator(".stone").count(), 2, "回退到人机历史节点后无法创建替代分支");
    await page.getByRole("button", { name: "删除当前一步及后续变化" }).click();
    await page.getByRole("button", { name: "撤销" }).click();
    await clickPoint(page, "B1");
    assert.equal(await page.locator(".stone").count(), 2, "人机历史节点删除后撤销无法创建替代分支");
    await context.close();
  }

  {
    const { context, page } = await freshPage();
    for (const coordinate of ["H8", "I8", "H9"]) await clickPoint(page, coordinate);
    await page.getByRole("button", { name: "上一手" }).click();
    await clickPoint(page, "H8");
    assert.equal(await page.locator(".stone").count(), 2, "点击已有棋子不应把棋谱光标跳到该手");
    await clickPoint(page, "J9");
    assert.equal(await page.locator(".stone").count(), 3, "回退到旧节点后无法创建普通打谱分支");
    await context.close();
  }

  {
    const { context, page } = await freshPage();
    await page.getByRole("button", { name: "AI" }).click();
    await page.getByRole("button", { name: /开始人机对战/ }).click();
    await page.getByRole("button", { name: "退出对弈" }).waitFor();
    await page.getByRole("button", { name: "退出对弈" }).click();
    await page.getByRole("button", { name: "退出对弈" }).waitFor({ state: "detached" });
    await context.close();
  }

  {
    const { context, page } = await freshPage();
    for (const coordinate of ["H8", "I8", "H9"]) await clickPoint(page, coordinate);
    await page.getByRole("button", { name: "删除当前一步及后续变化" }).click();
    await page.getByRole("button", { name: "撤销" }).click();
    await clickPoint(page, "J9");
    assert.equal(await page.locator(".stone").count(), 3, "删除后撤销无法继续编辑当前棋谱");
    await context.close();
  }

  {
    const { context, page } = await freshPage();
    await clickPoint(page, "H8");
    await page.getByRole("button", { name: "打开导入方式" }).click();
    const draftDialog = page.getByRole("dialog", { name: "未保存草稿" });
    await draftDialog.waitFor();
    assert.equal(await page.locator(".import-options").count(), 0, "导入面板不应盖住未保存草稿确认层");
    assert.equal(await draftDialog.evaluate((element) => getComputedStyle(element.parentElement).zIndex), "100", "未保存草稿确认层应位于普通面板之上");
    await draftDialog.getByRole("button", { name: "取消" }).click();
    await page.getByRole("button", { name: "AI" }).click();
    await page.getByRole("dialog", { name: "未保存草稿" }).waitFor();
    assert.equal(await page.locator(".ai-game-setup").count(), 0, "AI 设置面板不应盖住未保存草稿确认层");
    await context.close();
  }

  console.log("AI rule browser verification passed: five-two, Taraguchi swap, winning line, think panel, AI reply, branch navigation, delete undo, draft guard priority.");
} finally {
  await browser.close();
}
