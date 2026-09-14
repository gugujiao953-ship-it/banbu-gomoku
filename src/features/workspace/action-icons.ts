import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, CircleDot, FilePlus2, Gauge, ListTree, MessageSquareText, MoreHorizontal, PenLine, Play, Power, Redo2, Save, Shield, Sparkles, SquarePen, Swords, Tag, Trash2, Undo2, X } from "lucide-react";
export const ACTION_ICONS = {
  comment: MessageSquareText, new: FilePlus2, save: Save, delete: Trash2, color: CircleDot,
  navStart: ChevronFirst, navPrev: ChevronLeft, navNext: ChevronRight, navEnd: ChevronLast,
  navUndo: Undo2, navRedo: Redo2, navDiscard: X, playback: Play,
  analysis: Gauge, analysisToggle: Power, annotation: Tag, notes: SquarePen, tree: ListTree, view: MoreHorizontal, play: Swords, setup: PenLine, vcf: Sparkles, rule: Shield,
};
