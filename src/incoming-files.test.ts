// @ts-expect-error The application intentionally excludes Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 安卓文件关联的静态一致性（用户 2026-09-23）。
//
// 这些断言守不住「真机上点文件能不能打开」——那只能装上包手点一遍。它们守的是
// **结构别退化**：manifest 的三组 intent-filter 与扩展名清单、插件被注册、冷热两条路
// 都在、以及最要命的一条「暂存文件读完即删」。最后这条是防「同一份棋谱被导入两遍」
// 的回归：一旦有人把删除调用去掉，这里立刻红。
const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

describe("Android incoming-file association", () => {
  const manifest = read("../android/app/src/main/AndroidManifest.xml");
  const activity = read("../android/app/src/main/java/cn/renjunote/mobile/MainActivity.java");
  const plugin = read("../android/app/src/main/java/cn/renjunote/mobile/IncomingFilePlugin.java");

  it("declares VIEW / SEND / SEND_MULTIPLE so files can be opened and shared to the app", () => {
    expect(manifest).toContain('android:name="android.intent.action.VIEW"');
    expect(manifest).toContain('android:name="android.intent.action.SEND"');
    expect(manifest).toContain('android:name="android.intent.action.SEND_MULTIPLE"');
    // VIEW 必须带 BROWSABLE/DEFAULT 才会出现在「打开方式」里。
    expect(manifest).toContain('android:name="android.intent.category.BROWSABLE"');
  });

  it("covers every format the import pipeline supports", () => {
    // 与 App.tsx 的导入白名单保持一致；加了新格式就要在这里补一条。
    const extensions = ["sgf", "fgf", "ren", "renjs", "wzq", "psq", "pos", "txt", "json", "renju", "lib", "dp", "db", "zip"];
    for (const extension of extensions) {
      const pathPattern = `pathPattern=".*\\\\.${extension}"`;
      const upper = `pathPattern=".*\\\\.${extension.toUpperCase()}"`;
      expect(manifest.includes(pathPattern) || manifest.includes(upper), `缺少 .${extension} 的关联声明`).toBe(true);
    }
  });

  it("also accepts images so a shared screenshot reaches the recognizer", () => {
    expect(manifest).toContain('android:mimeType="image/*"');
  });

  it("keeps every intent-filter's data entries typed (an empty mimeType never matches)", () => {
    // <data> 只写 scheme 不写 mimeType 在部分系统上匹配不到任何东西；这里防止漏写。
    const dataTags = manifest.match(/<data[^>]*>/g) || [];
    expect(dataTags.length).toBeGreaterThan(10);
    for (const tag of dataTags) {
      expect(tag.includes("mimeType") || tag.includes("pathPattern"), `这个 <data> 既没类型也没扩展名：${tag}`).toBe(true);
    }
  });

  it("registers the plugin and keeps both cold-start and warm-start paths", () => {
    expect(activity).toContain("registerPlugin(IncomingFilePlugin.class)");
    // 冷启动：onCreate 里从 getIntent() 取（那时 bridge 还没就绪，只能暂存）。
    expect(activity).toContain("stageFromIntent(this, getIntent())");
    // 热启动：singleTask 复用实例时走 onNewIntent。
    expect(activity).toContain("protected void onNewIntent(Intent intent)");
    expect(activity).toContain('triggerJSEvent("incomingFiles"');
  });

  it("clears the staging directory when files are taken (no double import)", () => {
    expect(plugin).toContain("public void takeFiles(PluginCall call)");
    // 读完即删：这是防重复导入的关键，去掉就会让同一份棋谱下次启动再被取一遍。
    expect(plugin).toContain("deleteQuietly(entry)");
    expect(plugin).toContain("META_SUFFIX");
  });

  it("reads EXTRA_STREAM, because a single share never fills ClipData", () => {
    // 2026-10-03 真机报障：微信/QQ「分享 → 本应用」把应用叫起来却什么都不导入。
    // 根因是单份分享时系统只填 EXTRA_STREAM，而原实现只读 getData() 与 getClipData()。
    expect(plugin).toContain("Intent.EXTRA_STREAM");
    expect(plugin).toContain("instanceof Uri");
    // 系统按 manifest 叫起了应用却没交出文件时必须出声，别让用户对着空界面猜。
    expect(plugin).toContain("Toast.makeText");
  });

  it("keeps the cold-start probe wide enough to survive a loaded phone", () => {
    const incoming = read("./features/incoming/incoming-files.ts");
    const attempts = Number(/PROBE_ATTEMPTS = (\d+)/.exec(incoming)?.[1] ?? 0);
    const retryMs = Number(/PROBE_RETRY_MS = (\d+)/.exec(incoming)?.[1] ?? 0);
    // 探不到就把文件留在暂存区，于是变成「过一会儿重开才冒出解析失败」——窗口按 10 秒起算。
    expect(attempts * retryMs).toBeGreaterThanOrEqual(10_000);
  });

  it("routes external files by content, not by the name or mimeType the sender chose", () => {
    const incoming = read("./features/incoming/incoming-files.ts");
    expect(incoming).toContain("sniffIncomingFile");
    expect(incoming).toContain("applySniff");
  });

  it("needs no storage permission (reads via ContentResolver into the private dir)", () => {
    // 本功能刻意不新增权限：content:// 读取与私有目录写入都不需要。
    const permissions = manifest.match(/<uses-permission[^>]*>/g) || [];
    expect(permissions.every((tag: string) => !/MANAGE_EXTERNAL_STORAGE|READ_MEDIA/.test(tag))).toBe(true);
  });
});
