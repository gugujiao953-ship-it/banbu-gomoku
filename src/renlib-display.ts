import type { RenLibDisplayMark } from "./types";

/** Conservative display mapping. Raw values are always preserved; meanings are UI conventions. */
export const renLibDisplayMark = (rawText?: string, rawColor?: string | number, rawMark?: number | string): RenLibDisplayMark => {
  const normalized = (rawText || "").trim().toLowerCase();
  if (normalized === "a") return { rawText, rawColor, rawMark, semantic: "good", displayKind: "text", displayText: "a" };
  if (normalized === "c" || normalized === "ccc") return { rawText, rawColor, rawMark, semantic: "bad", displayKind: "text", displayText: "c" };
  if (normalized === "黑" || normalized === "black") return { rawText, rawColor, rawMark, semantic: "special", displayKind: "black-dot" };
  if (normalized === "白" || normalized === "white") return { rawText, rawColor, rawMark, semantic: "bad", displayKind: "white-dot" };
  if (normalized === "蓝" || normalized === "blue") return { rawText, rawColor, rawMark, semantic: "special", displayKind: "blue-dot" };
  if (rawText) return { rawText, rawColor, rawMark, semantic: "unknown", displayKind: "text", displayText: rawText.slice(0, 4) };
  return { rawText, rawColor, rawMark, semantic: "unknown", displayKind: "neutral-dot" };
};
