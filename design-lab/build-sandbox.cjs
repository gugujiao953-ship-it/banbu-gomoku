// Builds design-lab/gomoku-design-lab.html — a standalone sandbox that mirrors
// the real app's 20-theme token system and current library UI, so an external
// model (e.g. Gemini web) can redesign the look in one file and hand it back.
// Re-run after app token changes: node design-lab/build-sandbox.cjs
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const styles = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");

// --- extract :root default vars + every themed :root[data-theme] var block ---
const tokenBlocks = [];
const blockRe = /:root([^{]*)\{([^}]*)\}/g;
let match;
while ((match = blockRe.exec(styles))) {
  const body = match[2];
  if (!/--(ink|muted|paper|line|green|jade|gold|red|surface|color-)\w*\s*:/.test(body)) continue;
  tokenBlocks.push(`:root${match[1].trim()} {\n${body.trim()}\n}`);
}
const themes = [...new Set([...tokenBlocks.join("\n").matchAll(/data-theme="([^"]+)"/g)].map((m) => m[1]))];
const tokensCss = tokenBlocks.join("\n\n");
fs.writeFileSync(path.join(__dirname, "extracted-tokens.css"), tokensCss);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>半步五子棋打谱 · 设计沙盒</title>
<style>
/* ==================================================================
   区块 A —— 主题令牌（禁止修改）
   这 20 套主题是真实软件里逐字导出的，软件靠切换 html 的 data-theme
   换肤。任何配色都必须引用这些变量，写死色值 = 换主题必坏。
   ================================================================== */
${tokensCss}

/* ==================================================================
   区块 B —— 沙盒骨架（禁止修改）
   ================================================================== */
* { box-sizing: border-box; margin: 0; }
body { font-family: Inter, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; background: var(--color-bg); color: var(--ink); }
.lab-bar { position: sticky; top: 0; z-index: 50; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 14px; background: var(--surface, var(--paper)); border-bottom: 1px solid var(--line); }
.lab-bar label { font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 5px; }
.lab-bar select { height: 28px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-3, var(--paper)); color: var(--ink); font-size: 11px; padding: 0 6px; }
.lab-note { font-size: 10px; color: var(--muted); margin-left: auto; }
.lab-stage { max-width: 420px; margin: 18px auto; border-radius: 18px; overflow: hidden; border: 1px solid var(--line); background: var(--paper); box-shadow: 0 18px 48px #0002; }
html[data-size="large"] .lab-stage { font-size: 1.15em; }
html[data-size="xlarge"] .lab-stage { font-size: 1.3em; }
.lab-tabs { display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid var(--line); background: var(--paper); }
.lab-tabs button { min-height: 54px; border: 0; background: transparent; color: var(--muted); font-size: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; }
.lab-tabs button.on { color: var(--green-2, var(--green)); font-weight: 800; }

/* ==================================================================
   区块 C —— 现有组件外观（★ 设计区：欢迎在这里重新设计 ★）
   下面这些就是软件当前的样子；DOM 结构和类名是真实软件里的，
   重设计时请保留类名与结构，只改视觉（可增删此区块内的规则）。
   ================================================================== */
.topbar { height: 58px; display: flex; align-items: center; gap: 10px; padding: 0 14px; background: var(--surface, var(--paper)); border-bottom: 1px solid var(--line); }
.brand-mark { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 11px; color: #f7f3e7; background: linear-gradient(145deg, var(--green), var(--green-2, var(--green))); font: 700 16px serif; }
.brand b { display: block; font-family: Georgia, "Songti SC", serif; font-size: 15px; letter-spacing: .08em; }
.brand small { display: block; font-size: 9px; color: var(--muted); }
.library-segment { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin: 12px 12px 6px; }
.library-segment button { min-height: 42px; border: 1px solid var(--surface-border, var(--line)); border-radius: 12px; background: var(--surface, var(--paper)); color: var(--muted); font-size: 11px; font-weight: 700; }
.library-segment button.on { background: var(--jade); border-color: var(--green); color: var(--green-2, var(--green)); }
.section-title { margin: 14px 14px 6px; font-size: 10px; letter-spacing: .12em; color: var(--muted); }

/* 棋谱库：文件夹 + 棋谱卡 */
.folder-section { border: 1px solid var(--surface-border, var(--line)); border-radius: 14px; background: var(--surface, var(--paper)); overflow: hidden; margin: 6px 10px 12px; }
.folder-head { width: 100%; min-height: 56px; display: flex; align-items: center; gap: 9px; padding: 8px 10px; border: 0; background: var(--surface, var(--paper)); color: var(--gold); text-align: left; }
.folder-head > span { flex: 1; min-width: 0; }
.folder-head b { display: block; font-size: 12px; color: var(--ink); }
.folder-head small { display: block; margin-top: 3px; font-size: 9px; color: var(--muted); }
.row-actions { display: flex; gap: 5px; }
.icon-btn { width: 32px; height: 32px; flex: 0 0 32px; border: 1px solid var(--surface-border, var(--line)); border-radius: 9px; background: var(--surface, var(--paper)); color: var(--muted); display: grid; place-items: center; font-size: 13px; }
.record-list { display: flex; flex-direction: column; }
.record { min-height: 76px; display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-top: 1px solid var(--surface-border, var(--line)); }
.grip { flex: 0 0 14px; width: 14px; align-self: stretch; display: grid; place-items: center; color: var(--muted); }
.mini-board { width: 56px; height: 56px; border-radius: 11px; background-color: #d3aa6b; background-image: linear-gradient(#5a483322 1px, transparent 1px), linear-gradient(90deg, #5a483322 1px, transparent 1px); background-size: 10px 10px; display: grid; grid-template-columns: 1fr 1fr; place-items: center; position: relative; flex-shrink: 0; }
.mini-board .dot-b, .mini-board .dot-w { width: 15px; height: 15px; border-radius: 50%; }
.mini-board .dot-b { background: #24231f; }
.mini-board .dot-w { background: #f8f6ee; border: 1px solid #777; }
.mini-board b { position: absolute; right: 3px; bottom: 3px; font-size: 8px; background: #ffffffdd; color: #3a3731; padding: 2px 4px; border-radius: 5px; }
.record-info { flex: 1; min-width: 0; }
.record-info h3 { font: 700 13px Georgia, "Songti SC", serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.record-info p { font-size: 9px; color: var(--muted); margin-top: 3px; }
.folder-empty { padding: 16px; text-align: center; font-size: 9px; color: var(--muted); }

/* 题库：题集卡 + 管理面板 */
.puzzle-card { border: 1px solid var(--surface-border, var(--line)); border-radius: 13px; background: var(--surface, var(--paper)); margin: 6px 10px; overflow: hidden; }
.puzzle-main { display: flex; align-items: center; gap: 9px; padding: 9px; }
.chip { width: 40px; height: 40px; flex-shrink: 0; border-radius: 11px; background: var(--gold); color: var(--paper); display: grid; place-items: center; font-size: 16px; font-weight: 900; font-family: Georgia, serif; }
.puzzle-main .titles { flex: 1; min-width: 0; }
.puzzle-main .titles b { display: block; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.puzzle-main .titles small { display: block; margin-top: 3px; font-size: 9px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.puzzle-tools { display: flex; align-items: center; gap: 6px; padding: 0 9px 9px 58px; }
.puzzle-tools select { flex: 1; min-width: 0; height: 29px; border: 1px solid var(--surface-border, var(--line)); border-radius: 8px; background: var(--surface-3, var(--paper)); color: var(--muted); font-size: 9px; }
.puzzle-tools button { min-height: 29px; padding: 0 9px; border: 1px solid var(--surface-border, var(--line)); border-radius: 8px; background: var(--surface-3, var(--paper)); color: var(--green-2, var(--green)); font-size: 9px; font-weight: 800; white-space: nowrap; }
.manager { border-top: 1px solid var(--surface-border, var(--line)); background: var(--surface-3, var(--paper)); }
.manager-row { min-height: 46px; display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-top: 1px solid var(--surface-border, var(--line)); }
.manager-row:first-child { border-top: 0; }
.num { width: 26px; height: 26px; flex: 0 0 26px; border-radius: 8px; background: var(--jade); color: var(--green-2, var(--green)); display: grid; place-items: center; font-size: 9px; font-weight: 800; }
.manager-row b { flex: 1; min-width: 0; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 设置页 */
.settings-page { padding: 14px; background: var(--paper); }
.settings-group { border: 1px solid var(--surface-border, var(--line)); border-radius: 14px; background: var(--surface, var(--paper)); overflow: hidden; }
.setting-row { min-height: 60px; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-top: 1px solid var(--surface-border, var(--line)); }
.setting-row:first-child { border-top: 0; }
.setting-row > span { flex: 1; }
.setting-row b { display: block; font-size: 12px; }
.setting-row small { display: block; margin-top: 4px; font-size: 9px; color: var(--muted); }
.switch { width: 43px; height: 25px; flex: 0 0 43px; border-radius: 20px; background: var(--line); position: relative; }
.switch i { position: absolute; left: 3px; top: 3px; width: 19px; height: 19px; border-radius: 50%; background: var(--paper); box-shadow: 0 1px 4px #0003; transition: .2s; }
.switch.on { background: var(--green); }
.switch.on i { left: 21px; }
.choice-pills { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-top: 14px; }
.choice-pills button { min-height: 50px; border: 1px solid var(--surface-border, var(--line)); border-radius: 11px; background: var(--surface, var(--paper)); color: var(--ink); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; }
.choice-pills button b { font-size: 11px; }
.choice-pills button small { font-size: 8px; color: var(--muted); }
.choice-pills button.sel { border-color: var(--green); background: var(--jade); color: var(--green-2, var(--green)); }
/* ==================================================================
   区块 D —— 在这里追加你的重设计（推荐把新增/修改规则写在这里，
   方便回传时一眼看出改了哪些）
   ================================================================== */
</style>
</head>
<body>
<div class="lab-bar">
  <label>主题 <select id="theme">${themes.map((t) => `<option value="${t}">${t}</option>`).join("")}</select></label>
  <label>字号 <select id="size"><option value="normal">正常</option><option value="large">大字</option><option value="xlarge">特大字</option></select></label>
  <span class="lab-note">切换即预览；令牌区与骨架区勿改</span>
</div>
<div class="lab-stage">
  <div class="topbar"><span class="brand-mark">半</span><div class="brand"><b>半步五子棋打谱</b><small>本地棋谱研究工具</small></div></div>
  <div class="library-segment"><button class="on">棋谱 7</button><button>题库 17</button></div>
  <div class="section-title">棋谱库</div>
  <div class="folder-section">
    <button class="folder-head"><span>📁</span><span><b>未分类</b><small>3 份棋谱 · 1 个子文件夹</small></span><span class="row-actions"><span class="icon-btn">⇅</span><span class="icon-btn"></span><span class="icon-btn">✎</span></span></button>
    <div class="record-list">
      <div class="folder-section" style="margin:6px 8px">
        <button class="folder-head"><span>📁</span><span><b>对局笔记</b><small>1 份棋谱</small></span><span class="row-actions"><span class="icon-btn">⇅</span></span></button>
        <div class="folder-empty">这个文件夹还是空的</div>
      </div>
      <div class="record"><span class="grip"></span><span class="mini-board"><span class="dot-b"></span><span class="dot-w"></span><b>18</b></span><span class="record-info"><h3>祁观 vs 弈心 · 人机大战第 3 局</h3><p>祁观 vs 弈心 · 2018 人类-vs-AI</p></span><span class="row-actions"><span class="icon-btn">✎</span><span class="icon-btn">🗑</span></span></div>
      <div class="record"><span class="grip">⠿</span><span class="mini-board"><span class="dot-b"></span><span class="dot-w"></span><b>52</b></span><span class="record-info"><h3>中盘屠龙实战练习</h3><p>黑方 vs 白方</p></span><span class="row-actions"><span class="icon-btn">✎</span><span class="icon-btn">🗑</span></span></div>
      <div class="record"><span class="grip">⠿</span><span class="mini-board"><span class="dot-b"></span><span class="dot-w"></span><b>9</b></span><span class="record-info"><h3>瑞斯谱开局速查</h3><p>研究库 · 大型棋谱 · 12,097 节点</p></span><span class="row-actions"><span class="icon-btn">✎</span><span class="icon-btn">🗑</span></span></div>
    </div>
  </div>
  <div class="section-title">题库</div>
  <div class="puzzle-card">
    <div class="puzzle-main"><span class="grip">⠿</span><span class="chip">題</span><span class="titles"><b>三手胜 2-初级题</b><small>8 / 30 已完成 · 开宝五子棋 1.5.1</small></span><span class="row-actions"><span class="icon-btn">›</span><span class="icon-btn">✎</span></span></div>
    <div class="puzzle-tools"><select><option>内置题库</option></select><button>管理 30 道题</button><button>⇅ 排序</button></div>
    <div class="manager">
      <div class="manager-row"><span class="grip">⠿</span><span class="num">1</span><b>第 1 题 · 黑先</b><span class="icon-btn">✎</span></div>
      <div class="manager-row"><span class="grip">⠿</span><span class="num">2</span><b>第 2 题 · 白先</b><span class="icon-btn">✎</span></div>
      <div class="manager-row"><span class="grip">⠿</span><span class="num">3</span><b>第 3 题 · 黑先</b><span class="icon-btn">✎</span></div>
    </div>
  </div>
  <div class="section-title">设置 · 外观与音效</div>
  <div class="settings-page" style="padding:0 10px 12px">
    <div class="settings-group">
      <div class="setting-row"><span><b>启用音效</b><small>关闭后不会创建或唤醒音频上下文</small></span><span class="switch on"><i></i></span></div>
      <div class="setting-row"><span><b>摆棋时音效</b><small>下一手、上一手等摆棋操作播放轻提示，落子声跟随总开关</small></span><span class="switch"><i></i></span></div>
      <div class="setting-row" style="flex-direction:column;align-items:stretch"><b style="font-size:11px">落子音色</b><small style="font-size:8px;color:var(--muted);margin-top:2px">只改变黑白落子的质感，导航与提示音保持清晰</small>
        <div class="choice-pills"><button class="sel"><b>经典</b><small>均衡、熟悉</small></button><button><b>木石</b><small>低沉、短促</small></button><button><b>清响</b><small>明亮、轻柔</small></button><button><b>实录</b><small>真实棋子敲击录音，随机微变</small></button></div>
      </div>
    </div>
  </div>
  <nav class="lab-tabs"><button class="on">🏠<span>打谱</span></button><button>📚<span>棋谱库</span></button><button>🤖<span>AI</span></button><button>⚙️<span>设置</span></button></nav>
</div>
<script>
const theme = document.getElementById("theme"), size = document.getElementById("size");
theme.value = "dark"; size.onchange = () => document.documentElement.dataset.size = size.value;
theme.onchange = () => document.documentElement.setAttribute("data-theme", theme.value);
document.documentElement.setAttribute("data-theme", theme.value);
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, "gomoku-design-lab.html"), html);
console.log(`sandbox written: ${path.join(__dirname, "gomoku-design-lab.html")} (${(html.length / 1024).toFixed(1)} KB), themes: ${themes.length}`);
