/** 侦察 2：新玩法在界面上的挂点（自定义开局 / 道具卡 / 每日一题 / 对弈屏） */
import { readFileSync, existsSync } from "node:fs";

const R = "D:/Projects/五子棋2/src/";
const files = [
  "features/duel/GameScreen.tsx",
  "features/duel/DuelPage.tsx",
  "features/progress/SoulShopPanel.tsx",
  "features/daily/DailyPuzzlePage.tsx",
  "features/vcf-challenge/VcfChallengePage.tsx",
];
for (const f of files) {
  if (!existsSync(R + f)) { console.log("(缺) " + f); continue; }
  const t = readFileSync(R + f, "utf8");
  console.log("=== " + f + " ===");
  const labels = [...new Set([...t.matchAll(/aria-label=\{?["'`]([^"'`{]{2,26})["'`]/g)].map((m) => m[1]))];
  console.log("  aria-label: " + (labels.slice(0, 20).join(" | ") || "(无)"));
  const cls = [...new Set([...t.matchAll(/className="([a-z][\w-]{4,34})"/g)].map((m) => m[1]))];
  console.log("  class: " + cls.slice(0, 16).join(" "));
  const texts = [...new Set([...t.matchAll(/>([\u4e00-\u9fa5]{2,12})</g)].map((m) => m[1]))];
  console.log("  屏上文字: " + texts.slice(0, 22).join(" / "));
  console.log();
}
