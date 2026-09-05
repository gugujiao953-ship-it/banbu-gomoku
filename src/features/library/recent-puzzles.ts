import type { PuzzleCollection, PuzzleProgress } from "../../puzzles";
import { puzzleProgressKey } from "../../puzzles";

export interface RecentPuzzleItem {
  collectionId: string;
  collectionIndex: number;
  collectionTitle: string;
  puzzleId: string;
  puzzleIndex: number;
  puzzleTitle: string;
  prompt: string;
  attempts: number;
  solved: boolean;
  updatedAt: string;
}

export const recentPuzzleItems = (collections: PuzzleCollection[], progress: PuzzleProgress, limit = 4): RecentPuzzleItem[] => {
  const items: RecentPuzzleItem[] = [];
  collections.forEach((collection, collectionIndex) => collection.puzzles.forEach((puzzle, puzzleIndex) => {
    const review = progress[puzzleProgressKey(collection.id, puzzle.id)];
    if (!review?.updatedAt || !review.attempts) return;
    items.push({
      collectionId: collection.id,
      collectionIndex,
      collectionTitle: collection.title,
      puzzleId: puzzle.id,
      puzzleIndex,
      puzzleTitle: puzzle.title || `第 ${puzzleIndex + 1} 题`,
      prompt: puzzle.prompt,
      attempts: review.attempts,
      solved: review.solved,
      updatedAt: review.updatedAt,
    });
  }));
  return items.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || a.puzzleTitle.localeCompare(b.puzzleTitle)).slice(0, limit);
};
