"use strict";
if ("importScripts" in self) {
    self.importScripts(
        "./IntervalPost.js",
        "./TextCoder.js",
        "./JFile.js",
        "./JPoint.js",
        "./LibraryFile.js",
        "./MoveList.js",
        "./MoveNode.js",
        "./Stack.js"
    );

    if ("WebAssembly" in self && typeof WebAssembly.instantiate == "function") {
        self.importScripts("./RenLibDoc_wasm.js");
    }
    else {
        self.importScripts("./RenLibDoc.js");
    }
}
else
    throw new Error("self.importScripts is undefined")

/*
cmd = [alert | log | warn | info | addBranch | addBranchArray | createTree | addTree | loading ...]
*/
let activeRequestId = 0;
function post(cmd, param, transfer) {
    if ((typeof cmd == "object" && cmd.constructor.name == "Error") || cmd == "onerror")
        postMessage({ requestId: activeRequestId, ok: false, cmd: "onerror", error: (cmd && cmd.message) || param || String(cmd) })
    else
        postMessage({ requestId: activeRequestId, ok: true, "cmd": cmd, "parameter": param, result: param }, transfer)
}


let renLibDoc = new RenLibDoc();

function getArrBuf(file) {
    return new Promise(function(resolve, reject) {
    	let fr = new FileReader();
        fr.onload = function() {
            resolve(fr.result)
        };
        fr.onerror = function(e) {
            reject("❌打开文件出错\n手机请用Edeg浏览器，获得更大内存\n" + (fr.error.message || ""))
        };
        fr.readAsArrayBuffer(file)
    });
}

async function openLib(file) {
    try {
        const buf = await getArrBuf(file);
        await renLibDoc.addLibrary(buf);
        const path = renLibDoc.getAutoMove();
        post("autoMove", path);
        post("resolve", { autoMove: path });
    }
    catch (err) {
        post("onerror", err && (err.stack || err.message) || err);
    }
}

function getAutoMove() {
    let path = renLibDoc.getAutoMove();
    post("autoMove", path);
    post("resolve", path);
}

function showBranchs(param) {
    let rt = renLibDoc.getBranchNodes(param.path);
    rt.position = param.position;
    post("showBranchs", rt);
    post("resolve", rt);
}

function setCenterPos(point) {
    renLibDoc.setCenterPos(point);
    post("resolve");
}

function setBufferScale(scl) {
    typeof renLibDoc.setBufferScale == "function" &&
        renLibDoc.setBufferScale(scl);
    post("resolve");
}

function setPostStart(start = 0) {
    typeof renLibDoc.setPostStart == "function" &&
        renLibDoc.setPostStart(start);
    post("resolve");
}

function lib2sgf() {
    renLibDoc.lib2sgf()
    .then(bufObj => {
        post("resolve", bufObj, [bufObj.buf])
    })
    .catch(err => {
        post("onerror", err);
    })
}

let bf = [];
const CMD = {
    openLib: openLib,
    getAutoMove: getAutoMove,
    showBranchs: showBranchs,
    setCenterPos: setCenterPos,
    setBufferScale: setBufferScale,
    setPostStart: setPostStart,
    lib2sgf: lib2sgf,
}
onmessage = function(e) {
    if (e.data) {
        activeRequestId = e.data.requestId || 0;
        let cmd = e.data.cmd,
            param = e.data.parameter;
        typeof CMD[cmd] == "function" && CMD[cmd](param);
    }
}
