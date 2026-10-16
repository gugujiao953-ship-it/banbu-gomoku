/** 把皮肤实验室的外观同步进本体：`预览/skins/*.js` → `src/appearance/materials/*.ts`。
 *
 *  为什么是"生成"而不是"搬一次就分家"：
 *    实验室那批文件本身就是「一个对象 = 一套外观」的数据，而本体旧写法要
 *    手写 `.board-X` CSS + defs +（异形子）JSX 三处。抄进本体再各改各的，
 *    两边必然漂移 —— 本轮删 20 个零件时已经尝过两份名单手动对齐的滋味。
 *    所以这里只做**机械转换**：正文一字不改，只把 `window.SKINS` 换成模块内数组。
 *    漂移由 `src/appearance/materials.test.ts` 用 `--check` 兜住。
 *
 *  用法：
 *    node scripts/sync-appearance-materials.mjs          生成
 *    node scripts/sync-appearance-materials.mjs --check   只检查是否最新（CI 用）
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LAB = join(ROOT, "预览");
const LAB_SKINS = join(LAB, "skins");
const OUT_DIR = join(ROOT, "src/appearance/materials");
const BANNER = "/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑\n"
  + "   node scripts/sync-appearance-materials.mjs\n"
  + "   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */\n"
  + "// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts\n";

/** 实验室靠 loader.js 里的 KEEP 白名单决定哪些外观真的上架；本体必须用同一份。 */
function readKeep() {
  const src = readFileSync(join(LAB_SKINS, "loader.js"), "utf8");
  const body = src.slice(src.indexOf("const KEEP = [") + "const KEEP = [".length);
  const list = body.slice(0, body.indexOf("];"));
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** 一个实验室皮肤文件 → 一个 ES 模块。 */
function transform(srcName, text) {
  if (!text.includes("window.SKINS")) throw new Error(`${srcName}: 找不到 window.SKINS，转换规则要更新`);
  let out = text
    // 声明行整行去掉（改由生成的模块头提供）
    .replace(/[ \t]*window\.SKINS = window\.SKINS \|\| \[\];\r?\n/, "")
    // 其余所有引用指向模块内数组
    .replaceAll("window.SKINS", "SKINS");
  if (out.includes("window.")) throw new Error(`${srcName}: 还残留别的 window 依赖，得手工处理`);
  return `${BANNER}\nimport type { Skin } from "../types";\n\nexport const SKINS: Skin[] = [];\n${out}`;
}

/** 实验室除了 `skins/*.js`，还有两枚**手工零件**（大漆、敦煌候选·联珠莲瓣）写在
 *  `预览/parts/parts.js` 的 `NEW` 数组里 —— 它们不是皮肤，第一个输入源覆盖不到。
 *  这里把「共用小工具」和「NEW 那一段」原文切出来，末尾加一个零件→皮肤的适配器。 */
function buildLabStones() {
  const src = readFileSync(join(LAB, "parts/parts.js"), "utf8");
  const slice = (fromRe, toRe, what) => {
    const a = src.search(fromRe);
    const b = src.search(toRe);
    if (a < 0 || b < 0 || b <= a) throw new Error(`parts.js: ${what} 的边界没找到，切分规则要更新`);
    return src.slice(a, b);
  };
  const helpers = slice(/[ ]{2}\/\*\* 确定性伪随机/, /[ ]{2}\/\* ── 一、从现有皮肤派生/, "小工具段");
  const defs = slice(/[ ]{2}const NEW = \[\];/, /[ ]{2}\/\* ── 三、装配/, "NEW 段");
  const body = `${helpers}\n${defs}\n`
    + `/** 手工零件 → 皮肤记录：去掉 st- 前缀当 id，只带棋子半边（没有盘字段，\n`
    + ` *  derive() 因此不会给它生成棋盘零件）。 */\n`
    + `export const SKINS: Skin[] = NEW.map((p: any) => ({\n`
    + `  id: String(p.id).replace(/^st-/, ""), name: p.name, group: p.group, swatch: p.swatch,\n`
    + `  defs: p.defs, vars: p.vars, selfRim: p.selfRim, stone: p.stone, stoneMotions: p.stoneMotions,\n`
    + `}));\n`;
  // 先查正文再拼 banner —— BANNER 自己就写着 "window.SKINS"，反过来查会被自己拦住
  if (body.includes("window.")) throw new Error("parts.js 切出来的段落里还有 window 依赖");
  return `${BANNER}\nimport type { Skin } from "../types";\n\n${body}`;
}

function build() {
  const files = readdirSync(LAB_SKINS).filter((f) => f.endsWith(".js") && f !== "loader.js" && !f.startsWith("_"));
  const emitted = new Map();
  for (const f of files) {
    const name = basename(f, ".js");
    emitted.set(`${name}.ts`, transform(f, readFileSync(join(LAB_SKINS, f), "utf8")));
  }
  const stones = buildLabStones();
  emitted.set("lab-stones.ts", stones);
  const keep = readKeep();
  const mods = [...emitted.keys()].sort();
  const alias = (m) => "SK_" + m.slice(0, -3).replace(/\W/g, "_");
  /* 实验室的顺序是「先按 KEEP 过滤皮肤 → 派生 → 再追加手工零件」，
     所以 lab-stones 不能进 KEEP 过滤（那两个 id 本来就不在皮肤名单里）。 */
  const skinMods = mods.filter((m) => m !== "lab-stones.ts");
  emitted.set("index.ts",
    `${BANNER}\nimport type { Skin } from "./types";\n\n`
    + mods.map((m) => `import { SKINS as ${alias(m)} } from "./materials/${m.slice(0, -3)}";`).join("\n")
    + `\n\n/** 实验室 loader.js 的 KEEP —— 只有名单里的外观上架。 */\n`
    + `export const KEEP = ${JSON.stringify(keep, null, 2)};\n\n`
    + `const SKINS_BY_FILE: Skin[] = [${skinMods.map((m) => `...${alias(m)}`).join(", ")}];\n`
    + `/** 手工零件（大漆、敦煌候选·联珠莲瓣）：不走 KEEP 过滤，实验室也是先过滤再追加。 */\n`
    + `const HANDMADE: Skin[] = [...${alias("lab-stones.ts")}];\n\n`
    + `/** 上架的全部皮肤，按 KEEP 的顺序。名单里写了但库里没有的 id 会被丢掉，\n`
    + ` *  由 appearance.test.ts 那条"KEEP 每个 id 都要找得到"的断言兜住。 */\n`
    + `export const SKINS: Skin[] = [\n`
    + `  ...KEEP.map((id) => SKINS_BY_FILE.find((s) => s.id === id)).filter(Boolean) as Skin[],\n`
    + `  ...HANDMADE,\n`
    + `];\n`);
  return { emitted, keep, count: files.length };
}

const { emitted, keep, count } = build();
const CHECK = process.argv.includes("--check");

if (CHECK) {
  const stale = [];
  for (const [name, text] of emitted) {
    const p = name === "index.ts" ? join(ROOT, "src/appearance/index.ts") : join(OUT_DIR, name);
    let cur = "";
    try { cur = readFileSync(p, "utf8"); } catch { cur = null; }
    if (cur !== text) stale.push(name);
  }
  if (stale.length) {
    console.error(`外观生成物已过期（${stale.length} 个）：\n  ` + stale.join("\n  ")
      + `\n跑一次：node scripts/sync-appearance-materials.mjs`);
    process.exit(1);
  }
  console.log(`✓ 本体外观与实验室一致（${count} 个源文件 / KEEP ${keep.length} 套）`);
} else {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, text] of emitted) {
    writeFileSync(name === "index.ts" ? join(ROOT, "src/appearance/index.ts") : join(OUT_DIR, name), text);
  }
  console.log(`已生成 ${count} 个材质模块 + index.ts（KEEP ${keep.length} 套）`);
}
