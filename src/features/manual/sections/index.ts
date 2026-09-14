import type { ManualSection } from "../manual-types";
import { ch01 } from "./ch01-first-open";
import { ch02 } from "./ch02-recent";
import { ch03 } from "./ch03-new-save";
import { ch04 } from "./ch04-modes";
import { ch05 } from "./ch05-tree-branch";
import { ch06 } from "./ch06-navigation";
import { ch07 } from "./ch07-annotation";
import { ch08 } from "./ch08-import-ocr";
import { ch09 } from "./ch09-export";
import { ch10 } from "./ch10-library";
import { ch11 } from "./ch11-puzzle";
import { ch12 } from "./ch12-vcf";
import { ch13 } from "./ch13-ai-game";
import { ch14 } from "./ch14-analysis";
import { ch15 } from "./ch15-backup";
import { ch16 } from "./ch16-appearance";
import { ch17 } from "./ch17-accessibility";
import { ch18 } from "./ch18-formats";
import { ch19 } from "./ch19-about";

/** 手册章节。顺序 = 目录编号 = 引导下标（App.tsx 的 MANUAL_TOURS[index]），勿调整。 */
export const manualSections: ManualSection[] = [
  ch01, ch02, ch03, ch04, ch05, ch06, ch07, ch08, ch09, ch10, ch11, ch12, ch13, ch14, ch15, ch16, ch17, ch18, ch19,
];
