import { compactChildCount, compactChildWindow, compactIndexOf, compactNodeId, compactNodeIndex } from "../../compact-index";
import type { CompactRenLibIndex, GameDocument, RecordNode } from "../../types";

/** Walk only the ancestry, including setup/comment nodes; never scan the whole library. */
export function treeAncestorPath(document: GameDocument, id: string): RecordNode[] {
  const reverse: RecordNode[] = [];
  const seen = new Set<string>();
  let next: string | null = id;
  while (next && !seen.has(next)) {
    seen.add(next);
    const node: RecordNode | undefined = document.nodes[next];
    if (!node) break;
    reverse.push(node);
    next = node.parentId;
  }
  return reverse.reverse();
}

/** Page siblings from the index without materialising a lazy children proxy. */
export function treeChildPage(document: GameDocument, id: string, start: number, size: number, suppliedIndex?: CompactRenLibIndex) {
  const node = document.nodes[id];
  const index = suppliedIndex ?? compactIndexOf(document);
  const at = index ? compactNodeIndex(document, id) : undefined;
  const loaded = index && at !== undefined ? compactChildCount(index, at) : node?.children.length ?? 0;
  const unloaded = Math.max(0, node?.unloadedChildren ?? 0);
  const ids = index && at !== undefined
    ? compactChildWindow(index, at, start, Math.min(loaded, start + size))
    : node?.children.slice(start, start + size) ?? [];
  return { ids, loaded, unloaded, total: loaded + unloaded };
}

/** Compare neighbouring moves without materialising a lazy parent's entire child list. */
export function treeSiblingChoices(document: GameDocument, id: string, suppliedIndex?: CompactRenLibIndex) {
  const parentId = document.nodes[id]?.parentId;
  if (!parentId) return { position: -1, total: 0, previous: undefined, next: undefined };
  const index = suppliedIndex ?? compactIndexOf(document);
  const parentAt = index ? compactNodeIndex(document, parentId) : undefined;
  const nodeAt = index ? compactNodeIndex(document, id) : undefined;
  if (index && parentAt !== undefined && nodeAt !== undefined) {
    let child = index.firstChild[parentAt] ?? -1, previous: string | undefined;
    const seen = new Set<number>();
    for (let position = 0; child >= 0 && child < index.nodeCount && !seen.has(child); position += 1) {
      if (child === nodeAt) {
        const next = index.nextSibling[child] ?? -1;
        return { position, total: compactChildCount(index, parentAt), previous, next: next >= 0 && next < index.nodeCount && !seen.has(next) && next !== child ? compactNodeId(index, next) : undefined };
      }
      seen.add(child);
      previous = compactNodeId(index, child);
      child = index.nextSibling[child] ?? -1;
    }
  } else {
    const children = document.nodes[parentId]?.children ?? [];
    const position = children.indexOf(id);
    if (position >= 0) return { position, total: children.length, previous: children[position - 1], next: children[position + 1] };
  }
  return { position: -1, total: 0, previous: undefined, next: undefined };
}
