/// <reference lib="webworker" />
import { searchVcf } from "./vcf";
import type { Cell, Player } from "./types";
import type { VcfOptions } from "./vcf";

interface SearchMessage { board: Cell[][]; attacker: Player; options: VcfOptions }

self.onmessage = (event: MessageEvent<SearchMessage>) => {
  self.postMessage(searchVcf(event.data.board, event.data.attacker, event.data.options));
};

export {};
