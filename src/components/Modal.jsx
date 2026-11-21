import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Pop-up shown over the page (a bottom sheet on phones), so results are visible without scrolling.
 * `dismissible`: whether tapping the dark background closes it (off while a form is being filled in,
 * so a stray tap doesn't throw away what was typed). Escape and the × button always close it.
 */
export default function Modal({ label, onClose, dismissible = true, children }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const panelRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden'; // keep the page behind from scrolling
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => dismissible && e.target === e.currentTarget && closeRef.current()}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={label} ref={panelRef} tabIndex={-1}>
        <button type="button" className="modal-close" onClick={() => closeRef.current()} aria-label="Close">
          ×
        </button>
        {children}
      </div>
    </div>,
    document.body
  );
}
