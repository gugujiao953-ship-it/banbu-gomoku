// Verifies the in-app engine pack (v3+) is the OFFICIAL rapfi.data byte-for-byte.
// History: v1/v2 shipped a repacked variant with uncompressed .bin weights; the
// engine rejects that layout and silently disables the mix9svq evaluator
// (verified against the official desktop binary), so the pack must stay official.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const OFFICIAL_SHA = "2fa58b1c9e005a7b39bbddb798097a8f1ff9ceaba4c9339d87ba7d324b9d846d";
const files = ["engine-packs/rapfi-full-v3.data", "artifacts/nnue/rapfi.data"];
let failed = false;
for (const file of files) {
  let hash;
  try {
    hash = createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch {
    console.log(`${file}: MISSING`);
    failed = true;
    continue;
  }
  const ok = hash === OFFICIAL_SHA;
  console.log(`${file}: ${ok ? "OK (official)" : `MISMATCH ${hash}`}`);
  if (!ok) failed = true;
}
// The mounted loader must keep the official .bin.lz4 manifest.
const js = readFileSync("public/rapfi/full/rapfi-single.js", "utf8");
const lz4Mounts = (js.match(/filename:"\/[^"]*\.bin\.lz4"/g) || []).length;
console.log(lz4Mounts === 4 && js.includes("remote_package_size:40306406") ? "loader manifest: official layout OK" : `loader manifest: BROKEN (lz4 mounts ${lz4Mounts})`);
if (lz4Mounts !== 4) failed = true;
// The in-app config tune (engine-pack.ts) targets the config.toml segment by
// hardcoded offsets; verify they still match the loader manifest.
const seg = /filename:"\/config\.toml",start:(\d+),end:(\d+)/.exec(js);
const EXPECT_START = 11470, EXPECT_END = 18183;
const segOk = seg && Number(seg[1]) === EXPECT_START && Number(seg[2]) === EXPECT_END;
console.log(segOk ? `config segment offsets: match engine-pack constants (${EXPECT_START}-${EXPECT_END})` : `config segment offsets: DRIFT (manifest ${seg ? seg[1] + "-" + seg[2] : "not found"} vs constants ${EXPECT_START}-${EXPECT_END})`);
if (!segOk) failed = true;
// The tune needle must exist inside the official segment (byte-identical).
const data0 = (() => { try { return readFileSync("engine-packs/rapfi-full-v3.data"); } catch { return null; } })();
if (data0) {
  const needle = Buffer.from("aspiration_window = true", "utf8");
  const segBytes = data0.subarray(EXPECT_START, EXPECT_END);
  const needleOk = segBytes.indexOf(needle) >= 0;
  console.log(needleOk ? "config tune needle: found in official segment" : "config tune needle: MISSING (official config changed?)");
  if (!needleOk) failed = true;
}
process.exit(failed ? 1 : 0);
