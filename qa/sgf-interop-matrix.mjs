/**
 * 门禁：SGF 互操作细节矩阵（导入 → 导出 → 再导入，逐节点逐字段比对）。
 *
 * 覆盖别的软件真的会写出来的东西：转义（`]` `\`）、注释里的圆括号与换行、标注文字含冒号、
 * 同点形状+文字（MA+LB）、**分支内部的标注**、摆局 AB/AW + PL、过手 `B[]`、多局文件、
 * 非 15 路 SZ、评价属性 TE/BM/DO/IT、空文字 `LB[dd:]`、宽松写法（小写属性/换行/空格）、
 * 属性值首尾空格，以及 FGF/REN/RENJS/WZQ 四种同语法扩展名的导入一致性。
 *
 * 2026-09-19 实测抓到并修掉两条：`LB[dd:]` 会造一个看不见也删不掉的标注（导出又丢，往返不一致）、
 * 标注文字首尾空格导入保留而导出裁掉（不一致）。现在导入统一 trim、空文字不造标注。
 *
 * 用法：BANBU_URL=http://localhost:5193 node qa/sgf-interop-matrix.mjs
 * 也接受 run-qa 注入的 QA_BASE_URL（已带 ?qa=1，下面按需补）。
 */
import { chromium } from "playwright";

const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://localhost:5193/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ serviceWorkers: "block" })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector(".app-shell", { timeout: 60000 });

const results = await page.evaluate(async () => {
  const formats = await import("/src/formats.ts");
  const encode = (text, charset = "utf-8") => {
    if (charset === "gbk") {
      // 极简 GBK 编码：够用于本探针里的中文用例（逐字查表由浏览器 TextEncoder 不支持，改用 Escape 技巧）
      return new Uint8Array([...text].map((ch) => ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : 0x3f));
    }
    return new TextEncoder().encode(text);
  };
  const importSgf = async (text, name = "t.sgf", charset = "utf-8") =>
    (await formats.importRecordFile(new File([encode(text, charset)], name, { type: "application/x-go-sgf" })));

  const sig = (document) => {
    const nodes = [];
    const walk = (id, path) => {
      const node = document.nodes[id];
      if (!node) return;
      const marks = (node.marks || []).map((m) => `${m.row},${m.col}:${m.kind}:${m.label || ""}`).sort().join("|");
      const setup = node.setup ? `B${node.setup.black.length}/W${node.setup.white.length}${node.setup.nextPlayer ? "/" + node.setup.nextPlayer : ""}` : "";
      nodes.push(`${path}:${node.move ? `${node.move.row},${node.move.col},${node.move.player}` : node.passPlayer ? `pass-${node.passPlayer}` : "none"}|C=${node.comment}|M=${marks}|T=${node.boardText || ""}|E=${node.evaluation || ""}|S=${setup}`);
      node.children.forEach((child, index) => walk(child, `${path}>${index}`));
    };
    walk(document.rootId, "R");
    return nodes;
  };

  const cases = [
    {
      name: "① 注释/标注里的转义 ] 与 \\",
      sgf: String.raw`(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]C[方括号 \] 与反斜杠 \\ 都在]LB[dd:带\]括号])`,
    },
    {
      name: "② 注释里的圆括号与换行",
      sgf: "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]C[第一行\n第二行 \\(括号\\)])",
    },
    {
      name: "③ 标注文字含冒号",
      sgf: "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]LB[dd:比分 3:2])",
    },
    {
      name: "④ 同点形状 + 文字（MA+LB）",
      sgf: "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]MA[dd]LB[dd:要点])",
    },
    {
      name: "⑤ 分支内部的标注（变化节点带 CR/LB）",
      sgf: "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh](;W[ii]CR[jj]LB[kk:分支标注])(;W[gg]TR[ff]))",
    },
    {
      name: "⑥ 摆局 AB/AW + PL + 标注",
      sgf: "(;GM[1]FF[4]CA[UTF-8]SZ[15]AB[dd][ee]AW[ff]PL[W];W[gg]LB[hh:先手标记])",
    },
    {
      name: "⑦ 过手 B[]",
      sgf: "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh];W[];B[ii]C[过手之后])",
    },
    {
      name: "⑧ 多局文件（两局）",
      sgf: "(;GM[1]FF[4]CA[UTF-8]SZ[15]GN[第一局];B[hh]LB[dd:一])(;GM[1]FF[4]CA[UTF-8]SZ[15]GN[第二局];B[ii]LB[ee:二])",
    },
    {
      name: "⑨ 非 15 路 SZ[19] + 标注",
      sgf: "(;GM[1]FF[4]CA[UTF-8]SZ[19];B[jj]LB[dd:19路标注])",
    },
    {
      name: "⑩ 评价属性 TE/BM/DO/IT",
      sgf: "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]TE[1];W[ii]BM[2];B[gg]DO[];W[ff]IT[])",
    },
    {
      name: "⑪ 空文字 LB[dd:]",
      sgf: "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]LB[dd:])",
    },
    {
      name: "⑫ 宽松写法：小写属性 + 换行 + 空格",
      sgf: "(;gm[1]ff[4]ca[utf-8]sz[15]\n  ;b[hh]\n   lb[dd:小写]\n   c[注释])",
    },
    {
      name: "⑬ 属性值含前后空格",
      sgf: "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]C[  前后都有空格  ]LB[dd: 空格 ])",
    },
  ];

  const rows = [];
  for (const item of cases) {
    const entry = { name: item.name, problems: [] };
    try {
      const first = await importSgf(item.sgf);
      const firstSig = sig(first.document);
      const exported = formats.exportSgf(first.document);
      const second = await importSgf(exported, "t2.sgf");
      const secondSig = sig(second.document);
      entry.nodes = firstSig.length;
      if (firstSig.join("\n") !== secondSig.join("\n")) {
        const a = firstSig, b = secondSig;
        for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
          if (a[i] !== b[i]) entry.problems.push(`第${i}节点\n      导入: ${a[i] || "（无）"}\n      往返: ${b[i] || "（无）"}`);
        }
      }
      entry.exported = exported.slice(0, 160);
      entry.warnings = first.warnings || [];
    } catch (error) {
      entry.problems.push("⛔ 抛错: " + String(error).slice(0, 120));
    }
    rows.push(entry);
  }

  // ⑭ 四种同语法扩展名：同一内容换扩展名，导入结果应完全一致
  const extSgf = "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]LB[dd:标注](;W[ii]CR[jj])(;W[gg]))";
  const extSigs = {};
  for (const ext of ["sgf", "fgf", "ren", "renjs", "wzq"]) {
    try {
      const imported = await formats.importRecordFile(new File([new TextEncoder().encode(extSgf)], `t.${ext}`, { type: "application/octet-stream" }));
      extSigs[ext] = sig(imported.document).join("|");
    } catch (error) {
      extSigs[ext] = "⛔ " + String(error).slice(0, 60);
    }
  }

  return { rows, extSigs };
});

let failed = 0;
for (const row of results.rows) {
  const ok = row.problems.length === 0;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${row.name}${ok ? `（${row.nodes} 节点）` : ""}`);
  for (const problem of row.problems) console.log("      " + problem);
  if (!ok) console.log("      导出: " + row.exported);
  if (row.warnings?.length) console.log("      警告: " + row.warnings.join(" / ").slice(0, 100));
}
const uniq = new Set(Object.values(results.extSigs));
const extOk = uniq.size === 1;
if (!extOk) failed += 1;
console.log(`${extOk ? "PASS" : "FAIL"} ⑭ 四种同语法扩展名导入一致`);
if (!extOk) console.log("      " + JSON.stringify(results.extSigs, null, 1).slice(0, 700));
console.log(errors.length ? `\n页面错误：${errors.slice(0, 2).join(" | ")}` : "\n无页面错误");
console.log(failed ? `\n${failed} 项有问题` : "\n全部通过");
await browser.close();
process.exit(failed ? 1 : 0);
