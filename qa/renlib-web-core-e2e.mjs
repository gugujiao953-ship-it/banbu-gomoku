import { chromium } from "playwright";

const baseUrl = process.env.RENLIB_PREVIEW_URL || "http://127.0.0.1:5180/";
const filePath = process.argv[2] || "D:/五子棋/定式谱/雨.lib";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.id = "renlib-web-core-file";
    input.hidden = true;
    document.body.append(input);
  });
  await page.locator("#renlib-web-core-file").setInputFiles(filePath);

  const result = await page.evaluate(async () => {
    const file = document.querySelector("#renlib-web-core-file")?.files?.[0];
    if (!file) throw new Error("测试文件未进入浏览器");

    const worker = new Worker("/renlib/RenjuLib_worker.js");
    let requestId = 0;
    const send = (cmd, parameter, timeoutMs = 120_000) => new Promise((resolve, reject) => {
      const id = ++requestId;
      const events = [];
      const timer = setTimeout(() => {
        worker.removeEventListener("message", onMessage);
        reject(new Error(`${cmd} 超过 ${timeoutMs}ms 未完成`));
      }, timeoutMs);
      const onMessage = (event) => {
        if (event.data?.requestId !== id) return;
        events.push({ cmd: event.data.cmd, parameter: event.data.parameter });
        if (event.data.ok === false || event.data.cmd === "onerror") {
          clearTimeout(timer);
          worker.removeEventListener("message", onMessage);
          reject(new Error(event.data.error || `${cmd} 失败`));
          return;
        }
        if (event.data.cmd !== "resolve") return;
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        resolve({ final: event.data.result ?? event.data.parameter, events });
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage({ requestId: id, cmd, parameter });
    });

    const startedAt = performance.now();
    await send("setBufferScale", 3);
    const opened = await send("openLib", file, 180_000);
    const openMs = Math.round(performance.now() - startedAt);
    const root = await send("showBranchs", { path: [], position: Array(225).fill(0) });
    const autoMove = await send("getAutoMove");
    const first = root.final?.nodes?.[0];
    const child = first
      ? await send("showBranchs", { path: [first.idx], position: Array(225).fill(0) })
      : undefined;
    worker.terminate();

    return {
      file: { name: file.name, size: file.size },
      openMs,
      opened: opened.final,
      autoMove: autoMove.final,
      root: {
        branchCount: root.final?.nodes?.length ?? -1,
        commentLength: root.final?.innerHTML?.length ?? 0,
        sample: root.final?.nodes?.slice(0, 8),
      },
      firstChild: child && {
        path: [first.idx],
        branchCount: child.final?.nodes?.length ?? -1,
        commentLength: child.final?.innerHTML?.length ?? 0,
        sample: child.final?.nodes?.slice(0, 8),
      },
    };
  });

  if (result.root.branchCount < 1) throw new Error("网页核心打开成功但根节点没有可查询分支");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await context.close();
  await browser.close();
}
