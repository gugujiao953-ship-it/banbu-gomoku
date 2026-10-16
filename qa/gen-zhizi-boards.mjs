// 智子风格棋谱语料生成器（2026-10-13）。
//
// 为什么单开一个：用户的真实输入大量来自**智子 App 的截图**（木纹棋盘 + 那套棋子贴图），而现有
// 语料（self-*）全是「本应用自己的渲染风格」——两者是**不同域**，要在这个域上练得更准，就得有
// 这个域的带真值样本。素材**不是仿制**：直接用智子 APK 解包出来的原贴图，所以纹理层面同源。
//
// 素材来源（`_apk-lab/com.magictek.zhizigomoku.apk` → `res/drawable-mdpi-v4/`，已抽到
// `qa/fixtures/materials/zhizi-style/`）：
//   · src_go_images_board2.jpg    米色木纹棋盘面。**选它是有实测依据的**：用户截图的木面均值
//                                 RGB(223.5,207,185) 与它 RGB(221.8,203,179.6) 几乎一致；
//                                 另一张 board1 是橙木(235,180,91)，不是那个风格。
//   · src_go_images_stone_{black,white}.png  棋子贴图（272×272 带透明）
//   · src_go_images_ground2.jpg   棋盘外的花岗岩底纹（截图里就这一块）
//
// 几何比例按**真实截图像素**估（864px 宽、格距 54.4 那张）：
//   棋子直径/格距 = 0.84 ｜ 字号/格距 = 0.46 ｜ 线宽 ≈ 格距/26（近黑 #0C0100）｜ 木面留边 = 0.5 格距
//   （留边取 0.5 格距而不是真截图的 0.79：木面/花岗岩那条边界会被网格检测当成「第 0 条线」，
//    只要它离第一条线的距离接近 1 个格距，梳齿就在容差内接受它、整盘偏一行
//    （实测 z-002/z-003 多认 15 颗、读数正确率 0–2%）。挪到半格距后错开半个周期，
//    锁上去明显不吻合，检测器就回到真网格。**这只影响应用侧读图，训练用的裁剪是按真值
//    几何切的，不受它影响。**）
//   （「像不像」以并排目视校准为准：`qa/tmp-zhizi-side-by-side.mjs` 会把样张与真截图拼在一起。）
//
// 用法：QA_BASE_URL=http://127.0.0.1:5301/ python -等价：node qa/gen-zhizi-boards.mjs 60
//   SEED=91000 PLY_MIN=150 PLY_MAX=225 OUT_NAME=zhizi-2 node qa/gen-zhizi-boards.mjs 60
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://127.0.0.1:5301/";
const count = Number(process.argv[2] || 60);
const PLY_MIN = Math.max(1, Number(process.env.PLY_MIN || 40));
const PLY_MAX = Math.min(225, Number(process.env.PLY_MAX || 225));
const SEED = Number(process.env.SEED || 90000);
const WIDTHS = (process.env.WIDTHS || "1200,820,600").split(",").map((w) => Number(w.trim()));
/** 输出目录名：只允许字母数字与 -_（不含路径分隔符，从根上排除 `..` 与绝对路径）。 */
const OUT_NAME = process.env.OUT_NAME || "zhizi-style-boards";
if (!/^[A-Za-z0-9_-]{1,40}$/.test(OUT_NAME)) throw new Error(`OUT_NAME 只允许字母数字与 -_：${OUT_NAME}`);
const outDir = resolve(process.env.OUT_DIR || `qa/fixtures/materials/${OUT_NAME}`);
const styleDir = "/qa/fixtures/materials/zhizi-style";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(120000);
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-zhizi-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-zhizi-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const BATCH = 6;
const index = [];
mkdirSync(outDir, { recursive: true });
for (let start = 0; start < count; start += BATCH) {
  const specs = [];
  for (let i = start; i < Math.min(count, start + BATCH); i += 1) {
    specs.push({ name: `z-${String(i + 1).padStart(3, "0")}`, seed: SEED + i * 7919 });
  }
  const rendered = await page.evaluate(async ({ specs, widths, styleDir, plyMin, plyMax }) => {
    /** 确定性伪随机（LCG）：语料要可复现——同一 SEED 必须产出逐字节相同的图。
     *  非安全用途（不接受外部输入、不用于密钥场景）。 */
    const makeRng = (seed) => {
      // splitmix64（确定性、可复现）。**不用纯 LCG 取高位**：种子是等差数列时，
      // LCG 一步之后的高位仍与该等差线性相关 → 输出被压在窄区间（实测 240 盘的手数
      // 只落在 60–142，本该到 225，密集盘一盘没造出来）。splitmix64 的雪崩混合解决这个。
      const mask = (1n << 64n) - 1n;
      let state = BigInt(seed) & mask;
      return () => {
        state = (state + 0x9E3779B97F4A7C15n) & mask;
        let z = state;
        z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & mask;
        z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & mask;
        z = (z ^ (z >> 31n)) & mask;
        return Number(z & 0xFFFFFFFFn) / 0x100000000;
      };
    };
    const makeMoves = (seed, target) => {
      const rnd = makeRng(seed);
      const picks = [], seen = new Set();
      let row = 7, col = 7, guard = 0;
      while (picks.length < target && guard < 20000) {
        guard += 1;
        const crowded = picks.length > target * 0.6 ? 0.45 : 0.12;
        if (rnd() < crowded) { row = Math.floor(rnd() * 15); col = Math.floor(rnd() * 15); }
        else {
          row = Math.max(0, Math.min(14, row + [-1, 0, 0, 1][Math.floor(rnd() * 4)]));
          col = Math.max(0, Math.min(14, col + [-1, 0, 0, 1][Math.floor(rnd() * 4)]));
        }
        const key = `${row},${col}`;
        if (seen.has(key)) continue;
        seen.add(key);
        picks.push([row, col]);
      }
      for (let r = 0; r < 15 && picks.length < target; r += 1) {
        for (let c = 0; c < 15 && picks.length < target; c += 1) {
          if (seen.has(`${r},${c}`)) continue;
          seen.add(`${r},${c}`);
          picks.push([r, c]);
        }
      }
      return picks;
    };
    const loadImage = (url) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error(`加载失败 ${url}`));
      img.src = url;
    });
    const [wood, granite, stoneBlack, stoneWhite] = await Promise.all([
      loadImage(`${styleDir}/src_go_images_board2.jpg`),
      loadImage(`${styleDir}/src_go_images_ground2.jpg`),
      loadImage(`${styleDir}/src_go_images_stone_black.png`),
      loadImage(`${styleDir}/src_go_images_stone_white.png`),
    ]);
    // 几何比例（见文件头；与真实截图像素校准）
    const STONE_RATIO = 0.84, FONT_RATIO = 0.46, LINE_RATIO = 1 / 26, MARGIN_RATIO = 0.5;
    const LINE_COLOR = "#0C0100";
    const fontFamily = '"Arial Black", "Microsoft YaHei", Arial, sans-serif';
    const out = [];
    for (const spec of specs) {
      const target = plyMin + Math.floor(makeRng(spec.seed + 1)() * (plyMax - plyMin + 1));
      const moves = makeMoves(spec.seed, Math.min(225, target));
      const perWidth = [];
      for (const width of widths) {
        const size = 15;
        const boardPx = Math.round(width * 0.96);
        const margin = (boardPx * MARGIN_RATIO) / (size - 1 + 2 * MARGIN_RATIO);
        const spacing = (boardPx - 2 * margin) / (size - 1);
        const canvasH = Math.round(boardPx + width * 0.10);
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = canvasH;
        const ctx = canvas.getContext("2d");
        // 花岗岩底：平铺
        for (let y = 0; y < canvasH; y += granite.height) for (let x = 0; x < width; x += granite.width) ctx.drawImage(granite, x, y);
        // 木面：贴图旋转 90° 让纹理竖向，再拉伸到板面尺寸
        const left = Math.round((width - boardPx) / 2), top = Math.round((canvasH - boardPx) / 2);
        ctx.save();
        ctx.translate(left + boardPx / 2, top + boardPx / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(wood, -boardPx / 2, -boardPx / 2, boardPx, boardPx);
        ctx.restore();
        const ox = left + margin, oy = top + margin;
        // 网格与星位
        ctx.strokeStyle = LINE_COLOR; ctx.lineWidth = Math.max(1, Math.round(spacing * LINE_RATIO));
        for (let i = 0; i < size; i += 1) {
          ctx.beginPath(); ctx.moveTo(ox + i * spacing, oy); ctx.lineTo(ox + i * spacing, oy + (size - 1) * spacing); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(ox, oy + i * spacing); ctx.lineTo(ox + (size - 1) * spacing, oy + i * spacing); ctx.stroke();
        }
        ctx.fillStyle = LINE_COLOR;
        for (const [r, c] of [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]]) {
          ctx.beginPath(); ctx.arc(ox + c * spacing, oy + r * spacing, Math.max(2, spacing * 0.055), 0, Math.PI * 2); ctx.fill();
        }
        // 棋子贴图 + 序号
        const stonePx = Math.max(6, Math.round(spacing * STONE_RATIO));
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        // 坐标字（2026-10-13 补）：真截图上盘外有「列字母在下、行数字在左」这一圈字。
        // **不只是像不像的问题**：它们把「木面/花岗岩交界」这条强边缘打断开——少了它们，
        // 网格检测会锁到那条边界上、整盘下移一行（实测：多认 15 颗「白子」、读数正确率
        // 从 ~95% 掉到 0–2%）。字号与序号同源、颜色用网格线的近黑。
        const coordFont = `bold ${Math.max(7, Math.round(spacing * 0.42))}px ${fontFamily}`;
        ctx.font = coordFont;
        ctx.fillStyle = LINE_COLOR;
        for (let i = 0; i < size; i += 1) {
          // 四面都写：真截图那圈坐标字在上/左（放大图核过），下/右补齐——
          // **关键是上下左右都把那圈木面/花岗岩边界打断**，否则检测器会锁到边界上、
          // 整盘偏一行（实测 z-003：多认 15 颗、读数正确率 0–2%）。
          ctx.fillText(String.fromCharCode(65 + i), ox + i * spacing, oy + (size - 1) * spacing + margin * 0.55);
          ctx.fillText(String.fromCharCode(65 + i), ox + i * spacing, oy - margin * 0.55);
          ctx.fillText(String(size - i), ox - margin * 0.55, oy + i * spacing);
          ctx.fillText(String(size - i), ox + (size - 1) * spacing + margin * 0.55, oy + i * spacing);
        }
        moves.forEach(([row, col], i) => {
          const player = i % 2 === 0 ? "black" : "white";
          const x = ox + col * spacing, y = oy + row * spacing;
          ctx.drawImage(player === "black" ? stoneBlack : stoneWhite, x - stonePx / 2, y - stonePx / 2, stonePx, stonePx);
          ctx.font = `bold ${Math.max(7, Math.round(spacing * FONT_RATIO))}px ${fontFamily}`;
          ctx.fillStyle = player === "black" ? "#ffffff" : "#1a120c";
          ctx.fillText(String(i + 1), x, y + 1);
        });
        perWidth.push(canvas.toDataURL("image/jpeg", 0.92));
      }
      out.push({ name: spec.name, moves, images: perWidth });
    }
    return out;
  }, { specs, widths: WIDTHS, styleDir, plyMin: PLY_MIN, plyMax: PLY_MAX });
  for (const board of rendered) {
    WIDTHS.forEach((width, slot) => {
      const file = `${board.name}@${width}.jpg`;
      writeFileSync(resolve(outDir, file), Buffer.from(board.images[slot].split(",")[1], "base64"));
      writeFileSync(resolve(outDir, `${board.name}@${width}.truth.json`), JSON.stringify({
        boardSize: 15,
        stones: board.moves.map(([row, col], plies) => ({ row, col, player: plies % 2 === 0 ? "black" : "white", number: plies + 1 })),
      }, null, 1));
      index.push({ file, stones: board.moves.length, width });
    });
  }
  process.stdout.write(`\r已生成 ${Math.min(count, start + BATCH)}/${count} 盘`);
}
writeFileSync(resolve(outDir, "index.json"), JSON.stringify(index, null, 1));
console.log(`\n共 ${index.length} 张（${count} 盘 × ${WIDTHS.length} 档宽度）→ ${outDir}`);
await browser.close();
