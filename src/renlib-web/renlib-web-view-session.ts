import { createDocument } from "../game";
import type { GameDocument, Position, RecordNode } from "../types";
import { RenLibWebSession, type RenLibWebBranchResult } from "./renlib-web-session";

const RENLIB_WEB_VIEW = Symbol("banbu-renlib-web-view");
type RenLibWebDocument = GameDocument & { [RENLIB_WEB_VIEW]?: true };

const idxToPosition = (idx: number): Position => ({ row: Math.floor(idx / 15), col: idx % 15 });
const positionToIdx = (position: Position) => position.row * 15 + position.col;

const commentText = (html?: string) => {
  if (!html) return "";
  const root = document.createElement("div");
  root.innerHTML = html;
  root.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  return (root.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
};

export class RenLibWebViewSession {
  private readonly core = new RenLibWebSession();
  private path: number[] = [];
  private readonly queries = new Map<number, RenLibWebBranchResult>();
  private base?: GameDocument;

  private nodeId(depth: number) {
    if (!this.base || depth === 0) return this.base?.rootId || "renlib-web-root";
    return `${this.base.id}-renlib-${this.path.slice(0, depth).map((idx) => idx.toString(16)).join("-")}`;
  }

  private projection(): { document: GameDocument; currentId: string } {
    if (!this.base) throw new Error("RenLib 网页核心尚未打开");
    const depth = this.path.length;
    const nodes: Record<string, RecordNode> = {};
    for (let index = 0; index <= depth; index += 1) {
      const id = this.nodeId(index);
      const nextId = index < depth ? this.nodeId(index + 1) : undefined;
      const query = this.queries.get(index);
      nodes[id] = {
        id,
        parentId: index ? this.nodeId(index - 1) : null,
        children: nextId ? [nextId] : [],
        move: index ? { ...idxToPosition(this.path[index - 1]), player: index % 2 ? "black" : "white" } : null,
        comment: commentText(query?.innerHTML),
        marks: [],
        preferredChildId: nextId,
      };
    }

    // Preserve cached alternatives on every loaded position. This lets a
    // user click a visible sibling directly after reaching a leaf instead of
    // having to go back first, and keeps projection/navigation semantics in
    // sync with ordinary SGF trees.
    for (let index = 0; index <= depth; index += 1) {
      const parentId = this.nodeId(index), parent = nodes[parentId];
      const selected = index < depth ? this.path[index] : undefined;
      for (const branch of this.queries.get(index)?.nodes || []) {
        if (branch.idx === selected) continue;
        const id = `${parentId}-branch-${branch.idx.toString(16)}`;
        nodes[id] = {
          id,
          parentId,
          children: [],
          move: { ...idxToPosition(branch.idx), player: index % 2 ? "white" : "black" },
          comment: "",
          marks: [],
          boardText: branch.txt || "",
          renLibNativeLabel: true,
          renLibLabelColor: branch.color,
        };
        parent.children.push(id);
        if (!parent.preferredChildId) parent.preferredChildId = id;
      }
    }

    const currentId = this.nodeId(depth);

    const projected: RenLibWebDocument = { ...this.base, nodes, savedCurrentId: currentId };
    Object.defineProperty(projected, RENLIB_WEB_VIEW, { value: true });
    return { document: projected, currentId };
  }

  private async query(depth = this.path.length) {
    const result = await this.core.branches(this.path.slice(0, depth));
    this.queries.set(depth, result);
  }

  async open(file: File) {
    this.base = createDocument(file.name.replace(/\.[^.]+$/, ""), 15);
    this.base.metadata.sourceFormat = "lib";
    this.base.metadata.sourceFileName = file.name;
    this.path = [];
    this.queries.clear();
    const opened = await this.core.open(file);
    const autoMove = Array.isArray(opened?.parameter?.autoMove)
      ? opened.parameter.autoMove
      : Array.isArray(opened?.result?.autoMove) ? opened.result.autoMove : [];
    this.path = autoMove.filter((idx: unknown): idx is number => Number.isInteger(idx) && Number(idx) >= 0 && Number(idx) < 225);
    for (let depth = 0; depth <= this.path.length; depth += 1) await this.query(depth);
    return this.projection();
  }

  async move(position: Position) {
    const idx = positionToIdx(position);
    const current = this.queries.get(this.path.length);
    if (!current?.nodes.some((branch) => branch.idx === idx)) throw new Error("这个位置不在当前 RenLib 分支中");
    this.path.push(idx);
    await this.query();
    return this.projection();
  }

  async moveFromDepth(depth: number, position: Position) {
    this.path = this.path.slice(0, Math.max(0, depth));
    return this.move(position);
  }

  async back() {
    if (this.path.length) this.path.pop();
    if (!this.queries.has(this.path.length)) await this.query();
    return this.projection();
  }

  async root() {
    this.path = [];
    if (!this.queries.has(0)) await this.query(0);
    return this.projection();
  }

  async toDepth(depth: number) {
    this.path = this.path.slice(0, Math.max(0, depth));
    if (!this.queries.has(this.path.length)) await this.query();
    return this.projection();
  }

  close() { this.core.close(); }
}

export const isRenLibWebView = (document: GameDocument) => Boolean((document as RenLibWebDocument)[RENLIB_WEB_VIEW]);
