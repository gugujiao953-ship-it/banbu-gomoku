export const ANNOTATION_HIGHLIGHT_KEY = "banbu-annotation-highlight-v1";

export type AnnotationHighlight = "none" | "white" | "gold" | "blue";

export const DEFAULT_ANNOTATION_HIGHLIGHT: AnnotationHighlight = "none";

export const normalizeAnnotationHighlight = (value: unknown): AnnotationHighlight =>
  value === "white" || value === "gold" || value === "blue" ? value : DEFAULT_ANNOTATION_HIGHLIGHT;

export const loadAnnotationHighlight = (): AnnotationHighlight => {
  try { return normalizeAnnotationHighlight(localStorage.getItem(ANNOTATION_HIGHLIGHT_KEY)); }
  catch { return DEFAULT_ANNOTATION_HIGHLIGHT; }
};

export const saveAnnotationHighlight = (value: AnnotationHighlight) => {
  try { localStorage.setItem(ANNOTATION_HIGHLIGHT_KEY, normalizeAnnotationHighlight(value)); }
  catch { /* optional visual preference */ }
};

export const annotationHighlightColor = (value: AnnotationHighlight): string | null =>
  value === "white" ? "#ffffff" : value === "gold" ? "#ffd76a" : value === "blue" ? "#6ec8ff" : null;
