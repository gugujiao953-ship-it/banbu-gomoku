import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useOverlayHistory } from "./useOverlayHistory";

interface BottomSheetProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  manageHistory?: boolean;
}

export function BottomSheet({ title, children, onClose, className = "", manageHistory = false }: BottomSheetProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = globalThis.document?.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusable = () => dialog
      ? Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])"))
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

  useEffect(() => {
    const body = globalThis.document?.body;
    if (!body) return undefined;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    if (scrollbarWidth > 0) {
      const currentPaddingRight = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${currentPaddingRight + scrollbarWidth}px`;
    }
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, []);

  useOverlayHistory(manageHistory, onClose);

  return <div className={`sheet-backdrop ${className}`.trim()} onMouseDown={onCloseRef.current}>
    <section
      ref={dialogRef}
      className="bottom-sheet"
      onMouseDown={(event) => event.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
    >
      <div className="sheet-handle"/>
      <div className="sheet-head">
        <h2>{title}</h2>
        <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="关闭"><X size={20}/></button>
      </div>
      {children}
    </section>
  </div>;
}
