// 发布站点版本文件（T35）：把最新正式版本写进公开仓 gh-pages 的 version.json，
// 应用内「检查更新」的多源链第一优先就读它（手机网络常常连不上 api.github.com，
// 但 github.io / jsDelivr 可用——应用内引擎包就是走同一主机验证过的）。
//
// 用法（发版流程里 gh release create 之后跑一次）：
//   HTTPS_PROXY=http://127.0.0.1:7897 node scripts/publish-version-json.mjs 1.1.8
//   可选：--tag v1.1.8 --date 2026-09-10T..." --dry-run
// 依赖：git（推送走代理；仓库公开，只需推送权限）
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = "gugujiao953-ship-it/banbu-gomoku";
const BRANCH = "gh-pages";
const args = process.argv.slice(2);
const version = (args.find((a) => !a.startsWith("--")) || "").trim().replace(/^v/i, "");
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("用法: node scripts/publish-version-json.mjs <版本号，如 1.1.8> [--tag v1.1.8] [--date ISO] [--dry-run]");
  process.exit(1);
}
const flag = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const tag = flag("--tag") || `v${version}`;
const publishedAt = flag("--date") || new Date().toISOString().replace(/\.\d+Z$/, "Z");
const dryRun = args.includes("--dry-run");
const payload = {
  version,
  tag,
  publishedAt,
  url: `https://github.com/${REPO}/releases/tag/${tag}`,
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
  const unchanged = existing && existing.version === version && existing.tag === tag;
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
  console.log(`校验：curl -s https://gugujiao953-ship-it.github.io/banbu-gomoku/version.json`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
