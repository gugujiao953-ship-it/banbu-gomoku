# Android 发布工具长期归档

2026-09-02 已生成长期复用的 Android 发布工具归档，包含：

- 当前 v2 Release 签名材料。
- Temurin JDK 21.0.12.1+1。
- 当前构建使用的 Android SDK、Android 36 平台和 Build Tools 35.0.0。
- Release 发布脚本、流程说明和当前正式 APK 校验清单。

归档文件位于 `artifacts/archives/`。需要恢复构建环境时，将归档内容解压到项目根目录，确保形成以下路径：

```text
artifacts/signing/banbu-release-v2.p12
artifacts/signing/banbu-release-v2.credential.xml
artifacts/tools/jdk21/jdk-21.0.12.1+1/
artifacts/tools/android-sdk/
```

恢复后，在项目根目录执行：

```powershell
npm run android:release
```

签名私钥和凭据属于敏感材料。归档使用独立的加密压缩密码，密码凭据保存在 `artifacts/archives/banbu-android-release-kit-20260902.archive-credential.xml`。该凭据由当前 Windows 用户保护，不要把密码、私钥或凭据文件提交 Git、上传公共网盘或粘贴到聊天中。迁移到其他 Windows 用户或电脑时，需要使用原归档密码重新建立本机凭据。
