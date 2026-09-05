export { RecordTreePanel as TreePanel } from "./features/record-tree/RecordTreePanel";
export type { RecordTreePanelProps as TreePanelProps } from "./features/record-tree/RecordTreePanel";

// Compatibility entry point retained for existing imports. The implementation
// lives under features so tree data operations and UI can evolve independently
// from App.tsx.
