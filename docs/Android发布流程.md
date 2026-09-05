# Android 发布流程

项目现在统一使用项目脚本打包 Android Release，避免依赖全局 Java 版本或口头环境配置。

## 打包

在项目根目录执行：

```powershell
npm run android:release
```

脚本会依次完成：

1. 检查 `package.json` 与 Android 的版本号是否一致。
2. 自动优先使用 `artifacts/tools/jdk21` 和 `artifacts/tools/android-sdk`；这两个目录已纳入长期发布工具归档。
3. 构建 Web/PWA 并同步 Capacitor Android 工程。
4. 复用 `artifacts/signing/banbu-release-v2.p12` 及同目录的本机凭据文件。
5. 使用短路径临时目录和独立 Gradle 缓存，规避 Windows Gradle loopback 问题。
6. 构建 `assembleRelease`，校验 APK 签名、包名、`versionCode`、`versionName` 和 SHA-256。
7. 将 APK、校验文件和 `release-manifest.json` 保存到 `artifacts/releases/<版本>/`。

如果 Web 产物已经由刚刚的构建生成，可以只跳过重复的 Web 构建：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-android-release.ps1 -SkipWebBuild
```

## 后续版本

发布新版本前同步修改：

- `package.json` 的 `version`
- `android/app/build.gradle` 的 `versionName`
- `android/app/build.gradle` 的 `versionCode`（每次发布递增）

然后继续执行 `npm run android:release`。后续版本必须继续使用 `banbu-release-v2.p12`，不要重新生成签名密钥。由于 v2 是在原 v1 私钥无法找回后新建的，第一次安装 v2 APK 时需要先卸载旧 v1 签名版本；从 v2 开始的后续版本可以正常覆盖升级。签名材料和本机凭据均不提交 Git。JDK、Android SDK、签名和发布脚本的恢复说明见 `docs/Android发布工具归档说明.md`。

本流程只负责生成和验证本地发布物；是否创建 Git tag、上传 GitHub Release 或进行真机安装，需要单独确认并执行。
