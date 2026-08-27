import { describe, expect, it } from "vitest";
import { renLibWebCoreFiles, renLibWebCoreScripts } from "./core-manifest";

describe("web RenLib core port", () => {
  it("lists every reference core asset in the port", () => {
    expect(renLibWebCoreFiles).toEqual(expect.arrayContaining([
      "JFile.js", "JPoint.js", "LibraryFile.js", "LibraryTree.js", "MoveList.js", "MoveNode.js",
      "RenLibDoc.js", "RenLibDoc_wasm.js", "RenjuLib.js", "RenjuLib_worker.js", "Stack.js",
      "UNICODE2GBK.js", "RenLib.wasm", "RenLib.wat",
    ]));
  });

  it("loads the UMD core in dependency order", () => {
    expect(renLibWebCoreScripts).toEqual([
      "../renlib-reference/IntervalPost.js",
      "../renlib-reference/TextCoder.js",
      "JFile.js",
      "JPoint.js",
      "LibraryFile.js",
      "MoveList.js",
      "MoveNode.js",
      "Stack.js",
      "RenLibDoc_wasm.js",
      "RenjuLib_worker.js",
    ]);
  });
});
