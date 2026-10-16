import { launch, boot, shot, settle, safeClick, dismissToast, STILLS, SEQ } from "./lib.mjs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
const { browser, context, page } = await launch();
const dir = path.join(SEQ, "jiutian");
await mkdir(dir, { recursive: true });
const moveBtn = n => page.locator(".moves-row, .puzzle-nav-row").getByRole("button",{name:n});
try{
  await boot(page);
  await safeClick(page.locator("nav.bottom-nav").getByRole("button",{name:"棋谱库"}));
  await settle(page,1800);
  await safeClick(page.getByText("九天指南v5-1",{exact:false}).first());
  await settle(page, 5000);
  const info=[];
  for (let i=0;i<10;i++){
    await page.screenshot({ path: path.join(dir, String(i).padStart(2,"0")+".png") });
    const t = await page.evaluate(()=>({
      head:(document.querySelector(".record-topbar")?.innerText||"").replace(/\n+/g," ").slice(0,60),
      txt: document.querySelectorAll(".renju-board text").length,
      stones: document.querySelectorAll(".stone-piece").length,
    }));
    info.push(`${i}: ${t.head} | 文字=${t.txt} 子=${t.stones}`);
    await safeClick(moveBtn("下一手")); await settle(page,520);
  }
  console.log(info.join("\n"));
}catch(e){ console.log("ERR", e.message.split("\n")[0]); }
await context.close().catch(()=>{}); await browser.close().catch(()=>{}); process.exit(0);
