/// <reference lib="webworker" />
// VCF 出题 worker：把素材驱动的生成（变形/原创）放到独立线程，避免阻塞主线程导致 UI 卡顿。
// 素材随请求传入（避免 worker 内 fetch 路径问题）；逐题生成并回报进度，最后回报全部结果。
import { generateVcfCollectionWithMaterial, type MaterialFile, type VcfTier, type VcfGenMode, type GeneratedVcfPuzzle } from "./vcf-corpus";

interface GenerateRequest { type: "generate"; tier: VcfTier; mode: VcfGenMode; count: number; seed: number; material: MaterialFile }
interface ProgressMessage { type: "progress"; done: number; attempts: number }
interface ResultMessage { type: "result"; puzzles: GeneratedVcfPuzzle[]; attempts: number; fallbackUsed: boolean; error: string | null }

self.onmessage = (event: MessageEvent<GenerateRequest>) => {
  const req = event.data;
  if (!req || req.type !== "generate") return;
  let attempts = 0;
  let fallbackUsed = false;
  let error: string | null = null;
  const puzzles: GeneratedVcfPuzzle[] = [];
  try {
    for (let i = 0; i < req.count; i += 1) {
      const r = generateVcfCollectionWithMaterial(req.material, { tier: req.tier, mode: req.mode, seed: req.seed + i * 7919, count: 1 });
      attempts += r.attempts;
      fallbackUsed = fallbackUsed || r.fallbackUsed;
      for (const p of r.puzzles) if (puzzles.length < req.count) puzzles.push(p);
      self.postMessage({ type: "progress", done: puzzles.length, attempts } satisfies ProgressMessage);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "生成失败";
  }
  self.postMessage({ type: "result", puzzles, attempts, fallbackUsed, error } satisfies ResultMessage);
};

export {};
