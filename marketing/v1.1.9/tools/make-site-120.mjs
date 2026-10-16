/** 生成 1.2.0 宣传页：复制 v1.1.9 站点 → 换版本串 → 换本版更新数组 → 落到 marketing/v1.2.0/site */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const SRC = "D:/Projects/五子棋2/marketing/v1.1.9/site/index.html";
const DST_DIR = "D:/Projects/五子棋2/marketing/v1.2.0/site";
const DST = DST_DIR + "/index.html";

let s = readFileSync(SRC, "utf8");
const report = [];

/* ---------- 1) 版本串（定向替换，避免误伤「1.1.9 引擎测试包」这类历史描述） ---------- */
const subs = [
  ["半步五子棋打谱 · v1.1.9 · 手机端五子棋打谱软件", "半步五子棋打谱 · v1.2.0 · 手机端五子棋打谱软件"],
  ["半步五子棋打谱 v1.1.9：", "半步五子棋打谱 v1.2.0："],
  ["半步五子棋打谱与研究 1.1.9", "半步五子棋打谱与研究 1.2.0"],
  ["BANBU / v1.1.9", "BANBU / v1.2.0"],
  ["CHANGELOG / v1.1.9", "CHANGELOG / v1.2.0"],
  ["BANBU GOMOKU · v1.1.9 · WEB &amp; ANDROID", "BANBU GOMOKU · v1.2.0 · WEB &amp; ANDROID"],
  ["BANBU GOMOKU · v1.1.9 · WEB & ANDROID", "BANBU GOMOKU · v1.2.0 · WEB & ANDROID"],
  ["SPEC v1.1.9", "SPEC v1.2.0"],
  ["banbu-gomoku-1.1.9-android-release.apk", "banbu-gomoku-1.2.0-android-release.apk"],
  ["releases/tag/v1.1.9", "releases/tag/v1.2.0"],
  [">SPEC / v1.1.9<", ">SPEC / v1.2.0<"],
  [">1.1.9<", ">1.2.0<"],
];
for (const [from, to] of subs) {
  const n = s.split(from).length - 1;
  if (n) { s = s.split(from).join(to); report.push(`替换 ${n} 处: ${from.slice(0, 44)}`); }
}
/* 裸的「 1.1.9 」标签（前后空格包裹的展示型） */
s = s.split(">1.1.9 ").join(">1.2.0 ");
report.push("剩余 1.1.9 出现次数: " + (s.match(/1\.1\.9/g) || []).length);

/* ---------- 2) 本版更新数组 ---------- */
const NEW_CATS = `const CATS=[{k:'all',n:'全部'},{k:'soul',n:'棋魂成就'},{k:'duel',n:'对弈玩法'},{k:'engine',n:'AI 引擎'},{k:'study',n:'打谱与挑战'},{k:'ui',n:'界面修补'}];`;

const NEW_LOGS = `const LOGS=[
  {c:'soul',no:'01',t:'「棋魂」上线：认真下过的每一手都算数',
   d:'下棋、做题、复盘、识谱、打谱批注、解锁成就都攒棋魂，点魂火也能攒。它衡量<em>你做了多少</em>，和等级分（你有多强）刻意分开记 —— 混在一起会让人以为花钱能变强。账本是流水，余额是算出来的，最近 50 笔在棋魂说明页可查。',
   g:['参与度货币','点魂火可攒','余额可追溯']},
  {c:'soul',no:'02',t:'棋魂「黑白水墨」主题成套上线',
   d:'配套主题跟棋魂一起到：解锁之后棋盘、棋子、界面一起换，不是只改一个颜色。',
   g:['棋魂主题','成套换肤']},
  {c:'soul',no:'03',t:'成就 89 项，分六类',
   d:'对弈、做题、研究、识谱、探索、棋魂六类，目录里能看进度（例如「对弈 0/22」），解锁当场弹提示。判定只看已有账本，历史数据挂载时自动兑现一次。',
   g:['89 项','六类分组','解锁即提示']},
  {c:'soul',no:'04',t:'棋魂商店：外观解锁 + 棋局道具',
   d:'攒下的棋魂能换主题、棋盘、棋子的<em>另一种样子</em>（默认那套本来就给你）；<b>道具卡</b>也能在同一个商店里买，支持批量解锁。解锁记录单独存，不会随账本折叠而过期。',
   g:['外观解锁','道具卡','批量解锁']},
  {c:'soul',no:'05',t:'道具卡进对局：悔棋按次花棋魂',
   d:'人机对弈里的悔棋改成<em>按次 10 棋魂</em>；VCF 挑战的道具栏、计时与加减分也在这一版一起调过，挑战不再只拼手速。',
   g:['悔棋 10 棋魂','VCF 道具栏','计时与加减分']},
  {c:'duel',no:'06',t:'人机对弈新增「自定义开局」',
   d:'自己摆子、随时点开始。摆好的一套固定开局能<em>存进本机局面库</em>，下次直接载入接着下 —— 练一个布局不用每次重摆。',
   g:['自己摆子','存局面','随时开始']},
  {c:'duel',no:'07',t:'开局也能从自己的棋谱库里挑',
   d:'从棋谱库或题库里挑一份当开局，分支照常在盘上显示，可以挑一条来打。',
   g:['棋库挑起手','分支可见','挑一条来打']},
  {c:'duel',no:'08',t:'自定义开局这一局不计棋魂、不计战绩',
   d:'摆出来的局面不参与棋魂与战绩统计，怎么试都不脏数据。',
   g:['不记战绩','练棋专用']},
  {c:'duel',no:'09',t:'对弈屏收掉打谱顶栏，棋盘吃满宽度',
   d:'偏矮的手机上人机对局棋盘不再被压扁。自定义开局的摆子界面也重排过：棋盘居中、进度在上、按钮在下，落子不再弹提示。',
   g:['棋盘吃满宽度','摆子屏重排','落子不弹提示']},
  {c:'duel',no:'10',t:'每日一题独立成页',
   d:'从对弈页直接进，棋盘、难度、用时、悔棋 / 重来都在自己一屏里，不再和打谱页共用界面。',
   g:['独立一页','难度与用时','分开的进度']},
  {c:'engine',no:'11',t:'旗舰引擎 KataGo 随包进手机（1.1.9.1 并入本版）',
   d:'KataGo 与 ONNX Runtime 随安装包一起进手机、本机原生运行，两套权重一起装上（小网 <b>3.2MB</b>、int8 大网 <b>21.9MB</b>），装好就能用、<em>不用下载任何东西</em>；内置 rapfi 同步升到 <b>0.43.02</b>。',
   g:['零下载','3.2MB + 21.9MB','0.43.02','1.1.9.1 并入']},
  {c:'engine',no:'12',t:'切到后台，引擎真的停了',
   d:'以前切出去几分钟再回来，局面和没保存的改动全没了 —— 原因是自愈保活把引擎又点着、连烧 5 分钟满核 CPU，被系统按<code>EXCESSIVE CPU USAGE</code>杀掉。现在切出即停（分析、AI 应手、整局复盘、生成一起停），回前台自动续上，对弈里轮到 AI 的那一手也会补回来。',
   g:['切出即停','回来自动续','局面不再凭空消失']},
  {c:'engine',no:'13',t:'引擎把给定的思考时间用满',
   d:'不再提前收手；第一次用「图片识谱」也不用再等识别引擎装载。',
   g:['用满预算','识谱首开更快']},
  {c:'study',no:'14',t:'VCF 挑战：45 秒一题，每手必须形成四',
   d:'等级分从 <b>1000</b> 起，每多一手 +200、封顶 <b>9100</b>；赢 +30、输 −10，最高 23 级。走错路线可以退回去重算，战绩留在本机。',
   g:['45 秒','封顶 9100','+30 / −10']},
  {c:'study',no:'15',t:'本机凭证：换手机不用从头攒',
   d:'棋魂、成就与解锁记录跟着本机凭证走，换机可恢复 —— 攒的东西不再只活在一台手机上。',
   g:['换机恢复','本机凭证']},
  {c:'ui',no:'16',t:'分支树的预览能折成一颗小按钮',
   d:'看盘想多留点地方，点一下就收起来，需要时再展开。',
   g:['可折叠','让出棋盘空间']},
  {c:'ui',no:'17',t:'使用手册逐条对过界面更正',
   d:'界面改过的说明都照着实物重写了一遍，避免「照手册点不到」。',
   g:['手册对齐界面']},
  {c:'ui',no:'18',t:'背景透明度与主题在老手机上也生效',
   d:'安卓 83 一类的老 WebView 上，主题动效画面、功能区底色、外观里的选择卡片全都跟着主题与透明度走；标注高亮挪到预览上方，透明度并进「棋盘显示」。',
   g:['老机型修复','主题动效','透明度生效']},
];`;

const catsStart = s.indexOf("const CATS=[");
const logsStart = s.indexOf("const LOGS=[");
if (catsStart < 0 || logsStart < 0) throw new Error("未找到 CATS / LOGS 数组");
const logsEnd = s.indexOf("\n];", logsStart);
if (logsEnd < 0) throw new Error("未找到 LOGS 数组结尾");
const afterCats = s.indexOf("\nconst LOGS=[", catsStart);
s = s.slice(0, catsStart) + NEW_CATS + "\n" + NEW_LOGS + s.slice(logsEnd + 3);

/* ---------- 3) 条目数（页面上写死的计数） ---------- */
s = s.replace(/(ENTRIES\s*<\/span>\s*<[^>]*>)\s*\d+/g, "$118");
s = s.replace(/(ENTRIES[^0-9]{0,40})(\d{1,2})(\s*<\/)/g, "$118$3");
report.push("更新条目数标记: " + ((s.match(/ENTRIES[^0-9]{0,40}\d{1,2}/) || [])[0] || "(未定位，页面可能是脚本渲染)"));
report.push("1.2.0 出现次数: " + (s.match(/1\.2\.0/g) || []).length);

if (!existsSync(DST_DIR)) mkdirSync(DST_DIR, { recursive: true });
writeFileSync(DST, s, "utf8");
console.log(report.join("\n"));
console.log("已写出: " + DST + "  (" + Math.round(s.length / 1024) + "KB)");
