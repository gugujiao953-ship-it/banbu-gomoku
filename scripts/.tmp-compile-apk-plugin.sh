#!/usr/bin/env bash
# 独立校验 ApkInstallPlugin 能否编译（本机缺 JDK 21 工具链，gradle 跑不起来）。
# 用真实 androidx core（FileProvider）+ Capacitor + android.jar 编译单个插件类。
set -euo pipefail
cd "$(dirname "$0")/.."
CAP_JAR="node_modules/@capacitor/android/capacitor/build/intermediates/aar_main_jar/release/syncReleaseLibJars/classes.jar"
OUT=".tmp-javac/out"
mkdir -p "$OUT"
CP="$(cygpath -w "$CAP_JAR");$(cygpath -w .tmp-javac/classes.jar);$(cygpath -w /d/android-sdk/platforms/android-36/android.jar)"
echo "classpath: $CP"
/d/java/bin/javac.exe -nowarn -encoding UTF-8 -source 17 -target 17 -cp "$CP" -d "$OUT" \
  android/app/src/main/java/cn/renjunote/mobile/ApkInstallPlugin.java
echo "=== compiled classes ==="
ls "$OUT"/cn/renjunote/mobile/
