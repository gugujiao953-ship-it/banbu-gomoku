import { importRecordFile } from "./formats";
import { summarizeLargeDocument } from "./large-storage";

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const result = await importRecordFile(event.data);
    const summary = event.data.size >= 4 * 1024 * 1024 || Object.keys(result.document.nodes).length >= 40000 ? summarizeLargeDocument(result.document) : undefined;
    self.postMessage({ ok: true, result, summary });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : "棋谱解析失败" });
  }
};
