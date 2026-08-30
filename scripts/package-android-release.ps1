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

$CredentialPath = Join-Path $ProjectRoot "artifacts/signing/banbu-release-v1.credential.xml"
$KeystorePath = Join-Path $ProjectRoot "artifacts/signing/banbu-release-v1.p12"
if (-not (Test-Path $CredentialPath) -or -not (Test-Path $KeystorePath)) {
  throw "Existing release signing material is missing; stopped to avoid creating an incompatible new key."
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
Write-Host "Signing: reusing banbu-release-v1.p12 (password is not printed)"

if (-not $SkipWebBuild) {
  Invoke-Checked "npm.cmd" @("run", "build") $ProjectRoot
}
Invoke-Checked "npx.cmd" @("cap", "sync", "android") $ProjectRoot
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
  jdk = $JdkHome
  androidSdk = $SdkHome
  buildCommand = "npm run android:release"
  builtAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json
Set-Content -LiteralPath (Join-Path $ReleaseDir "release-manifest.json") -Value $Manifest -Encoding utf8

Write-Host "Release APK: $ReleaseApk"
Write-Host "SHA-256: $Sha256"
Write-Host "Signature verification: passed"
Write-Host "Metadata verification: package/version passed"
