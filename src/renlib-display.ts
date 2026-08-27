import type { RenLibDisplayMark } from "./types";

/** The only text transformation performed by the webpage reader itself. */
export const formatRenLibWebLabel = (rawText?: string, ply = 1) => {
  if (!rawText) return "";
  if (rawText[0] === "W" || rawText[0] === "L") {
    const step = Number.parseInt(rawText.slice(1), 10) - ply;
    const text = `${rawText[0]}${step > 0 ? step : ""}`;
    return text.length < 3 ? `${"  ".slice(0, 3 - text.length)}${text}` : text;
  }
  if ((rawText[0] === "v" || rawText[0] === "m") && rawText.length > 1) {
    const value = Number.parseInt(rawText.slice(1), 10);
    const winRate = Math.max(0, Math.min(99, 100 / (1 + Math.exp((rawText[0] === "v" ? value : -value) / 200))));
    return `${Math.floor(winRate).toString().padStart(2, " ")}%`;
  }
  return rawText;
};

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
