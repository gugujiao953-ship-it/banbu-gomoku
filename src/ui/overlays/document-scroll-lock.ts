type ScrollLock = { count: number; restore: () => void };
const locks = new WeakMap<Document, ScrollLock>();

/** Lock the viewport without making body a new scroll ancestor for sticky bars.
 * A shared lease also keeps nested overlays locked when they close out of order. */
export function lockDocumentScroll(doc: Document = document): () => void {
  let lock = locks.get(doc);
  if (!lock) {
    const root = doc.documentElement;
    const body = doc.body;
    const view = doc.defaultView;
    const overflow = ["overflow-x", "overflow-y"].map((property) => ({
      property, value: root.style.getPropertyValue(property), priority: root.style.getPropertyPriority(property),
    }));
    const padding = body.style.getPropertyValue("padding-right");
    const paddingPriority = body.style.getPropertyPriority("padding-right");
    const scrollbarWidth = view ? Math.max(0, view.innerWidth - root.clientWidth) : 0;
    if (scrollbarWidth > 0 && view) {
      const currentPadding = Number.parseFloat(view.getComputedStyle(body).paddingRight) || 0;
      body.style.setProperty("padding-right", `${currentPadding + scrollbarWidth}px`);
    }
    root.style.setProperty("overflow", "hidden");
    // A single root marker gives the native compositor a stable signal while
    // any modal surface is present.  It is reference-counted with the scroll
    // lock so nested sheets do not thaw the animated scene prematurely.
    root.classList.add("overlay-open");
    lock = {
      count: 0,
      restore: () => {
        root.style.removeProperty("overflow");
        root.classList.remove("overlay-open");
        for (const { property, value, priority } of overflow) {
          if (value) root.style.setProperty(property, value, priority);
        }
        if (scrollbarWidth > 0) {
          if (padding) body.style.setProperty("padding-right", padding, paddingPriority);
          else body.style.removeProperty("padding-right");
        }
      },
    };
    locks.set(doc, lock);
  }
  lock.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lock.count === 0) {
      lock.restore();
      locks.delete(doc);
    }
  };
}
