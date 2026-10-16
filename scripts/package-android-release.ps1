param(
  [switch]$SkipWebBuild
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
  param(
    [string]$File,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  Push-Location $WorkingDirectory
  try {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed (exit code $LASTEXITCODE): $File $($Arguments -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$PackageJson = Get-Content -Raw (Join-Path $ProjectRoot "package.json") | ConvertFrom-Json
$Version = [string]$PackageJson.version
$GradleFile = Join-Path $ProjectRoot "android/app/build.gradle"
$GradleText = Get-Content -Raw $GradleFile
$VersionCodeMatch = [regex]::Match($GradleText, 'versionCode\s+(\d+)')
$VersionNameMatch = [regex]::Match($GradleText, 'versionName\s+"([^"]+)"')
if (-not $VersionCodeMatch.Success -or -not $VersionNameMatch.Success) {
  throw "Could not read versionCode/versionName from android/app/build.gradle"
}
$VersionCode = $VersionCodeMatch.Groups[1].Value
$VersionName = $VersionNameMatch.Groups[1].Value
if ($VersionName -ne $Version) {
  throw "Version mismatch: package.json=$Version, Android versionName=$VersionName"
}

$JdkCandidates = @((
  @(
  (Join-Path $ProjectRoot "artifacts/tools/jdk21/jdk-21.0.12.1+1"),
  $env:JAVA_HOME,
  "C:\Program Files\Android\Android Studio\jbr"
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) -and (Test-Path (Join-Path $_ "bin/java.exe")) }
))
if (-not $JdkCandidates) {
  throw "JDK 21 was not found. Prepare artifacts/tools/jdk21 or set JAVA_HOME."
}
$JdkHome = (Resolve-Path $JdkCandidates[0]).Path
$SdkCandidates = @((
  @(
  (Join-Path $ProjectRoot "artifacts/tools/android-sdk"),
  $env:ANDROID_HOME,
  $env:ANDROID_SDK_ROOT
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) -and (Test-Path (Join-Path $_ "platform-tools")) }
))
if (-not $SdkCandidates) {
  throw "Android SDK was not found. Prepare artifacts/tools/android-sdk or set ANDROID_HOME."
}
$SdkHome = (Resolve-Path $SdkCandidates[0]).Path

$CredentialPath = Join-Path $ProjectRoot "artifacts/signing/banbu-release-v2.credential.xml"
$KeystorePath = Join-Path $ProjectRoot "artifacts/signing/banbu-release-v2.p12"
if (-not (Test-Path $CredentialPath) -or -not (Test-Path $KeystorePath)) {
  throw "Release signing material is missing: banbu-release-v2.p12 and its credential file are required."
}
$Credential = Import-Clixml $CredentialPath
$PasswordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Credential.Password)
try {
  $PlainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($PasswordPtr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($PasswordPtr)
}

$env:JAVA_HOME = $JdkHome
$env:ANDROID_HOME = $SdkHome
$env:ANDROID_SDK_ROOT = $SdkHome
$env:BANBU_KEYSTORE_PATH = $KeystorePath
$env:BANBU_STORE_PASSWORD = $PlainPassword
$env:BANBU_KEY_ALIAS = $Credential.UserName
$env:BANBU_KEY_PASSWORD = $PlainPassword

$GradleHome = "C:\Temp\banbu-gradle"
New-Item -ItemType Directory -Force $GradleHome | Out-Null
$env:GRADLE_USER_HOME = $GradleHome
$env:TEMP = "C:\Temp"
$env:TMP = "C:\Temp"
$env:GRADLE_OPTS = "-Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Addresses=false -Djava.io.tmpdir=C:\Temp"

Write-Host "Banbu Gomoku Android Release packaging"
Write-Host "Version: $Version (versionCode $VersionCode)"
Write-Host "JDK: $JdkHome"
Write-Host "SDK: $SdkHome"
Write-Host "Signing: reusing banbu-release-v2.p12 (password is not printed)"

if (-not $SkipWebBuild) {
  Invoke-Checked "npm.cmd" @("run", "build") $ProjectRoot
}
# 手机 App 内不带网页版那份 40MB 引擎包（2026-10-07 用户要求：**只限手机 App 去掉，
# 网页版保留**）：安卓算力走 jniLibs 原生引擎 + assets/engine-native 权重，该包在
# APK 里是多余的一份。剥离动作交给 scripts/strip-android-engine-pack.mjs——它只删
# Capacitor 的拷贝目标、不碰 dist（此前这里直接删 dist/engine-packs，连网页版那份
# 也删了），且同一脚本已挂在 npm run android:sync 上，覆盖 Android Studio 手动打包。
# ⚠ 必须在 cap sync 之后调用（sync 会按 dist 原样重拷）。
if (-not (Test-Path (Join-Path $ProjectRoot "android/app/src/main/assets/engine-native/config.toml"))) {
  throw "缺少原生引擎权重：先跑 node scripts/build-android-engine.mjs 生成 assets/engine-native 与 jniLibs"
}
# **载荷字节和硬拦**（2026-10-13）：设备上 `NativeEnginePlugin.isPayloadComplete()` 拿这 9 件资产的
# 字节和当完整性标记，对不上就**根本不启动原生引擎**（用户看到的症状是"选了 Rapfi 却没反应/一直转"）。
# 这一条以前只在装好之后才暴露：数据包里的两个经典模型是 0.43.01 旧格式，而引擎已是 0.43.02（读不了旧模型），
# 谁手滑重跑一次旧版 build-android-engine.mjs 就会把模型退回旧版——包能装上、字节和差 24,693、引擎起不来。
# 生成脚本现在自己也会核对，但打包这一步是最后一道闸，别省。
$engineAssetsDir = Join-Path $ProjectRoot "android/app/src/main/assets/engine-native"
$engineAssetBytes = 0
foreach ($asset in @(
  "config.toml", "classical210901.toml", "classical220723.toml",
  "model210901.bin", "model220723.bin",
  "mix9svqfreestyle_bsmix.bin.lz4", "mix9svqstandard_bs15.bin.lz4",
  "mix9svqrenju_bs15_black.bin.lz4", "mix9svqrenju_bs15_white.bin.lz4"
)) {
  $assetPath = Join-Path $engineAssetsDir $asset
  if (-not (Test-Path $assetPath)) { throw "缺少原生引擎资产 $asset：先跑 node scripts/build-android-engine.mjs" }
  $engineAssetBytes += (Get-Item $assetPath).Length
}
$nativePluginPath = Join-Path $ProjectRoot "android/app/src/main/java/cn/renjunote/mobile/NativeEnginePlugin.java"
$payloadMatch = [regex]::Match((Get-Content -Raw -Encoding UTF8 $nativePluginPath), "ENGINE_PAYLOAD_BYTES = (\d+)L")
if (-not $payloadMatch.Success) { throw "读不到 NativeEnginePlugin.ENGINE_PAYLOAD_BYTES，没法校验原生引擎载荷" }
$payloadBytes = [int64]$payloadMatch.Groups[1].Value
if ($engineAssetBytes -ne $payloadBytes) {
  throw ("原生引擎资产字节和 $engineAssetBytes ≠ NativeEnginePlugin.ENGINE_PAYLOAD_BYTES $payloadBytes（差 " + ($engineAssetBytes - $payloadBytes) + "）。" +
    "装到手机上 isPayloadComplete() 会判非法、原生引擎不启动。别改 Java 里的常量迁就资产——把资产摆回配套的那套（见改造表 R194/R195）。")
}
Write-Host "原生引擎载荷字节和 $engineAssetBytes = 常量 ✓"
# KataGo 旗舰引擎（可选功能，但资产必须成套——二进制都不入库，靠脚本铺）：
# 缺二进制时 check() 会如实报不可用、设置页显示「当前设备不可用」，功能静默消失；
# 与其让用户装出一个「没有旗舰档」的包，不如在这里拦住。
# 三个引擎都必须在 jniLibs（Android 10+ 只有 nativeLibraryDir 里的文件允许 exec：
# 曾把智子两档铺到 assets → files/ 再 chmod，真机必然 EACCES，见插件头注释）。
foreach ($binary in @("libkatago-engine.so", "libkatago_zz.so")) {
  if (-not (Test-Path (Join-Path $ProjectRoot "android/app/src/main/jniLibs/arm64-v8a/$binary"))) {
    throw "缺少 KataGo 引擎二进制 $binary：先跑 node scripts/build-android-katago.mjs"
  }
}
foreach ($model in @("distill-fp16.onnx", "kata.cfg", "zhizi-b24-int8.onnx")) {
  if (-not (Test-Path (Join-Path $ProjectRoot "android/app/src/main/assets/engine-katago/$model"))) {
    throw "缺少 KataGo 资产：assets/engine-katago/$model（版本化输入，应从仓库取到）"
  }
}
Invoke-Checked "npx.cmd" @("cap", "sync", "android") $ProjectRoot
# cap sync 会按 dist 原样重拷，所以剥离必须紧跟其后（脚本只删 assets 侧副本、不碰 dist）。
Invoke-Checked "node.exe" @("scripts/strip-android-engine-pack.mjs") $ProjectRoot
Invoke-Checked (Join-Path $ProjectRoot "android/gradlew.bat") @("--no-daemon", "assembleRelease") (Join-Path $ProjectRoot "android")

$BuiltApk = Join-Path $ProjectRoot "android/app/build/outputs/apk/release/app-release.apk"
if (-not (Test-Path $BuiltApk)) {
  throw "Release build completed but APK was not found: $BuiltApk"
}

$ReleaseDir = Join-Path $ProjectRoot "artifacts/releases/$Version"
New-Item -ItemType Directory -Force $ReleaseDir | Out-Null
$ReleaseApk = Join-Path $ReleaseDir "banbu-gomoku-$Version-android-release.apk"
Copy-Item -LiteralPath $BuiltApk -Destination $ReleaseApk -Force

$BuildTools = Get-ChildItem (Join-Path $SdkHome "build-tools") -Directory |
  Sort-Object { [version]$_.Name } -Descending |
  Select-Object -First 1
$ApkSigner = Join-Path $BuildTools.FullName "apksigner.bat"
$Aapt2 = Join-Path $BuildTools.FullName "aapt2.exe"
if (-not (Test-Path $ApkSigner) -or -not (Test-Path $Aapt2)) {
  throw "Android SDK build-tools is missing apksigner or aapt2"
}

$VerifyOutput = & $ApkSigner verify --verbose $ReleaseApk 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "APK signature verification failed: $($VerifyOutput -join ' ')"
}
$Badging = & $Aapt2 dump badging $ReleaseApk 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Could not read APK metadata: $($Badging -join ' ')"
}
$PackageLine = ($Badging | Select-String "^package:").Line
if ($PackageLine -notmatch "name='cn\.renjunote\.mobile'" -or
    $PackageLine -notmatch "versionCode='$VersionCode'" -or
    $PackageLine -notmatch "versionName='$VersionName'") {
  throw "APK metadata does not match project version: $PackageLine"
}

$Sha256Algorithm = [System.Security.Cryptography.SHA256]::Create()
try {
  $Sha256 = ([System.BitConverter]::ToString($Sha256Algorithm.ComputeHash([System.IO.File]::ReadAllBytes($ReleaseApk))) -replace '-', '').ToUpperInvariant()
} finally {
  $Sha256Algorithm.Dispose()
}
$ShaFile = "$ReleaseApk.sha256"
Set-Content -LiteralPath $ShaFile -Value "$Sha256  $(Split-Path $ReleaseApk -Leaf)" -Encoding ascii

$Keytool = Join-Path $JdkHome "bin/keytool.exe"
$Fingerprint = "not-read"
if (Test-Path $Keytool) {
  $KeytoolOutput = & $Keytool -list -v -storetype PKCS12 -keystore $KeystorePath -storepass $PlainPassword 2>$null
  $FingerprintLine = $KeytoolOutput | Select-String "^\s*SHA256:" | Select-Object -First 1
  if ($FingerprintLine) { $Fingerprint = $FingerprintLine.Line.Trim() }
}

$Manifest = [ordered]@{
  product = "banbu-gomoku"
  packageName = "cn.renjunote.mobile"
  versionName = $VersionName
  versionCode = [int]$VersionCode
  apk = (Split-Path $ReleaseApk -Leaf)
  sha256 = $Sha256
  signingCertificate = $Fingerprint
  jdk = "Temurin 21"
  androidSdk = "Android SDK (local build environment)"
  buildCommand = "npm run android:release"
  builtAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json
Set-Content -LiteralPath (Join-Path $ReleaseDir "release-manifest.json") -Value $Manifest -Encoding utf8

Write-Host "Release APK: $ReleaseApk"
Write-Host "SHA-256: $Sha256"
Write-Host "Signature verification: passed"
Write-Host "Metadata verification: package/version passed"
