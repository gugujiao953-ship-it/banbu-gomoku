// 发布站点版本文件（T35）：把最新正式版本写进公开仓 gh-pages 的 version.json，
// 应用内「检查更新」的多源链第一优先就读它（手机网络常常连不上 api.github.com，
// 但 github.io / jsDelivr 可用——应用内引擎包就是走同一主机验证过的）。
//
// 用法（发版流程里 gh release create 之后跑一次）：
//   HTTPS_PROXY=http://127.0.0.1:7897 node scripts/publish-version-json.mjs 1.1.8
//   可选：--tag v1.1.8 --date 2026-09-10T..." --dry-run
// 依赖：git（推送走代理；仓库公开，只需推送权限）
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = "gugujiao953-ship-it/banbu-gomoku";
const BRANCH = "gh-pages";
const args = process.argv.slice(2);
const version = (args.find((a) => !a.startsWith("--")) || "").trim().replace(/^v/i, "");
// 版本号段数不限：应用侧 update-check.ts 的 parseVersion 是 `\d+(\.\d+)*`，
// 这里曾写死三段，于是四段版本（如 1.1.8.1）**发不出去 version.json**——
// 用户收不到更新提示（与「备份 appVersion 写死」同一家族，都是段数假设）。
if (!/^\d+(\.\d+)*$/.test(version)) {
  console.error([
    "用法: node scripts/publish-version-json.mjs <版本号，如 1.1.8.1> [选项]",
    "  --tag v1.1.8.1           发布 tag（默认 v<版本号>）",
    "  --date ISO              发布时间（默认当前时间）",
    "  --sha256 <HEX>          APK 的 SHA-256（也可用 --sha256-file <路径> 从 CI 产出的 .sha256 读）",
    "  --baidu <URL>           百度网盘分享链接（含 ?pwd=；不传则不显示该入口）",
    "  --lanzou <URL>          蓝奏云分享链接（不传则不显示该入口）",
    "  --lanzou-code <密码>    蓝奏云密码（可选）",
    "  --accel-prefix <URL>    加速反代前缀（默认 https://gh-proxy.com/，自动串在 apk 直链前面）",
    "  --accel <URL>           整条覆盖加速直链（换代理站时用这个）",
    "  --no-accel              不写加速直链",
    "  --dry-run               只打印将写入的内容，不推送",
    "",
    "说明：apk 直连地址不用传——应用会按标准文件名自行拼出 release 下载地址；",
    "      网盘入口是「传了才显示」，没传当期包的网盘就别传，界面不会指向旧包。",
  ].join("\n"));
  process.exit(1);
}
const flag = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const tag = flag("--tag") || `v${version}`;
const publishedAt = flag("--date") || new Date().toISOString().replace(/\.\d+Z$/, "Z");
const dryRun = args.includes("--dry-run");
// CI 产出的 <apk>.sha256 是「校验值  文件名」两列，取第一列即可。
const sha256File = flag("--sha256-file");
const sha256 = (flag("--sha256") || (sha256File ? String(readFileSync(sha256File, "utf8")).trim().split(/\s+/)[0] : "") || "").trim().toUpperCase();
if (sha256 && !/^[0-9A-F]{64}$/.test(sha256)) {
  console.error(`SHA-256 格式不对（应为 64 位十六进制）：${sha256}`);
  process.exit(1);
}
const mirrors = {};
const baidu = flag("--baidu");
const lanzou = flag("--lanzou");
const lanzouCode = flag("--lanzou-code");
if (baidu) mirrors.baidu = baidu;
if (lanzou) mirrors.lanzou = lanzou;
if (lanzouCode) mirrors.lanzouCode = lanzouCode;
const apkFilename = `banbu-gomoku-${version}-android-release.apk`;
const apkUrl = `https://github.com/${REPO}/releases/download/${tag}/${apkFilename}`;
// 加速直链：第三方 GitHub 反代，点一下就下载。前缀可换（--accel-prefix 或 --accel 整条覆盖），
// 换域名只要重发一次 version.json 就生效，不用等应用更新；--no-accel 则完全不写。
const accelPrefix = flag("--accel-prefix") || "https://gh-proxy.com/";
const accel = flag("--accel") || (flag("--no-accel") ? "" : `${accelPrefix}${apkUrl}`);
if (accel) mirrors.accel = accel;
const payload = {
  version,
  tag,
  publishedAt,
  url: `https://github.com/${REPO}/releases/tag/${tag}`,
  apk: apkUrl,
  ...(sha256 ? { sha256 } : {}),
  ...(Object.keys(mirrors).length ? { mirrors } : {}),
};

const dir = mkdtempSync(join(tmpdir(), "banbu-pages-"));
const git = (...gitArgs) => execFileSync("git", ["-C", dir, ...gitArgs], { stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
try {
  console.log(`克隆 ${BRANCH} → ${dir}`);
  execFileSync("git", ["clone", "--depth", "1", "--branch", BRANCH, `https://github.com/${REPO}.git`, dir], { stdio: ["ignore", "ignore", "inherit"] });
  writeFileSync(join(dir, "version.json"), `${JSON.stringify(payload, null, 2)}\n`);
  // 版本未变就不重复提交（避免每次发版流程都产生一次无意义 commit）
  let existing = null;
  try { existing = JSON.parse(git("show", `HEAD:version.json`)); } catch { existing = null; }
  const unchanged = existing && JSON.stringify(existing) === JSON.stringify(payload);
  git("add", "version.json");
  const changed = unchanged ? "" : git("status", "--porcelain");
  if (!changed) {
    console.log("version.json 内容无变化，无需推送");
  } else if (dryRun) {
    console.log("[dry-run] 将提交并推送：", JSON.stringify(payload));
  } else {
    execFileSync("git", ["-C", dir, "-c", "user.name=gugujiao953-ship-it", "-c", "user.email=gugujiao953@users.noreply.github.com", "commit", "-m", `version.json → ${version}`], { stdio: ["ignore", "ignore", "inherit"] });
    execFileSync("git", ["-C", dir, "push", "origin", BRANCH], { stdio: ["ignore", "ignore", "inherit"] });
    console.log(`已发布 version.json → ${version}`);
  }
  if (accel) console.log(`可直接发给群友的下载链接（点一下就下载）：${accel}`);
  console.log(`校验：curl -s https://gugujiao953-ship-it.github.io/banbu-gomoku/version.json`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
