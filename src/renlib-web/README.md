# RenLib web core port

This directory preserves the webpage ReadLib core source as a source-compatible reference.

The source is preserved in the webpage's original dependency order:

1. `IntervalPost.js` and `TextCoder.js` from `../renlib-reference/`
2. `JFile.js`, `JPoint.js`, `LibraryFile.js`, `MoveList.js`, `MoveNode.js`, `Stack.js`
3. `RenLibDoc_wasm.js` when WebAssembly is available, otherwise `RenLibDoc.js`
4. `RenjuLib_worker.js` command protocol

The classic worker is published by Vite under `/renlib/` together with its ordered script dependencies and `RenLib.wasm`. `RenLibWebSession` owns the request protocol, and `RenLibWebViewSession` projects only the current path and current branch set into the existing UI.

The copied implementation intentionally keeps the webpage's UMD/global model. Production `.lib` opening uses this core and does not pass through the legacy eager `GameDocument` parser. The old parser remains explicitly named `importRenLibLegacy` for comparison tests only and is tree-shaken from production output.

Real-browser acceptance currently covers 4.4MB, 131.8MB, and 1.185GB libraries. The 1.185GB sample reached the worker's final completion signal in 65.659 seconds and remained queryable afterwards.

Reference files copied from `tmp/renju-reference-20260827/ReadLib/script/`:
`JFile.js`, `JPoint.js`, `LibraryFile.js`, `LibraryTree.js`, `MoveList.js`, `MoveNode.js`, `RenLibDoc.js`, `RenLibDoc_wasm.js`, `RenjuLib.js`, `RenjuLib_worker.js`, `Stack.js`, `UNICODE2GBK.js`, `RenLib.wasm`, and `RenLib.wat`.
