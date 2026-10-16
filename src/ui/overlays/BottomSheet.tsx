import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useOverlayHistory } from "./useOverlayHistory";
import { lockDocumentScroll } from "./document-scroll-lock";
import { OverlayPattern, OverlayBrandMark, type OverlayAppearance } from "./OverlayBrand";

interface BottomSheetProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  manageHistory?: boolean;
  /** 不渲染标题行：内容自己顶到抓手下面（棋谱树这么用，用户 09-23：「腾出空间」）。
   *  关闭按钮仍在（浮在内容右上角），`aria-label` 也照旧，无障碍不受影响。 */
  hideTitle?: boolean;
  appearance?: OverlayAppearance;
}

export function BottomSheet({ title, children, onClose, className = "", manageHistory = false, hideTitle = false, appearance = "utility" }: BottomSheetProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = globalThis.document?.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusable = () => dialog
      ? Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex='-1'])"))
        .filter((element) => element.getClientRects().length > 0)
      : [];
    const focusFirst = () => (focusable()[0] || closeRef.current || dialog)?.focus({ preventScroll: true });
    const timer = window.setTimeout(focusFirst, 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && globalThis.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  // Lock before the first paint of the newly mounted sheet.  Doing this in
  // useEffect lets Android WebView paint the page once, then change the root
  // overflow in a second frame; that compositor pass is the visible flash.
  useLayoutEffect(() => lockDocumentScroll(), []);

  useOverlayHistory(manageHistory, onClose);

  return <div className={`sheet-backdrop ${className}`.trim()} onMouseDown={onCloseRef.current}>
    <section
      ref={dialogRef}
      className="bottom-sheet"
      data-overlay-appearance={hideTitle ? "utility" : appearance}
      onMouseDown={(event) => event.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
    >
      {!hideTitle && <div className="sheet-decoration" aria-hidden="true"><OverlayPattern/></div>}
      <div className="sheet-handle" aria-hidden="true"/>
      {hideTitle
        ? <button ref={closeRef} className="icon-button sheet-close-floating" onClick={onClose} aria-label="关闭"><X size={20}/></button>
        : <div className="sheet-head">
          <span className="sheet-emblem" aria-hidden="true"><OverlayBrandMark/></span>
          <h2>{title}</h2>
          <button ref={closeRef} className="icon-button sheet-close" onClick={onClose} aria-label="关闭"><X size={18}/></button>
        </div>}
      {children}
    </section>
  </div>;
}
