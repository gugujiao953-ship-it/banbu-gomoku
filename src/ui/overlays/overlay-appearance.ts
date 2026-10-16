import type { Sheet } from "../../app-shell-types";
import type { OverlayAppearance } from "./OverlayBrand";

const appearances: Partial<Record<Exclude<Sheet, null>, OverlayAppearance>> = {
  import: "gateway", coordinateCode: "gateway",
  aiGame: "arena", fifthCount: "arena", duelStats: "arena",
  save: "archive", export: "archive", metadata: "archive", folder: "archive",
  rename: "archive", dataSafety: "archive", versions: "archive", health: "archive",
  favorites: "archive", puzzleFavorites: "archive", trash: "archive", batchEdit: "archive",
  duelResume: "decision", about: "story", manual: "story", rules: "story", feedback: "story",
};

export function appearanceForSheet(sheet: Sheet): OverlayAppearance {
  return sheet ? appearances[sheet] ?? "utility" : "utility";
}
