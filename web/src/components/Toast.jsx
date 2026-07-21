import { createContext, useCallback, useContext, useMemo, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import { cn } from '../lib/utils';

const ToastContext = createContext(null);

const TOAST_DURATION_MS = 4000;
const TOAST_ERROR_DURATION_MS = 12000;

const ToastItem = memo(function ToastItem({ message, type }) {
  const styles = {
    success: 'border-emerald-200 bg-emerald-50/95 text-emerald-900',
    error: 'border-red-200 bg-red-50/95 text-red-900',
    warning: 'border-amber-200 bg-amber-50/95 text-amber-900',
    loading: 'border-blue-200 bg-blue-50/95 text-blue-900',
  };

  const Icon = type === 'success'
    ? CheckCircle2
    : type === 'error' || type === 'warning'
      ? ShieldAlert
      : Loader2;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-none flex w-[min(22rem,calc(100vw-2rem))] items-start gap-2.5 rounded-xl border px-4 py-3 text-[13px] shadow-lg',
        styles[type] || styles.error,
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          type === 'success' && 'text-emerald-600',
          type === 'error' && 'text-red-600',
          type === 'warning' && 'text-amber-600',
          type === 'loading' && 'animate-spin text-blue-600',
        )}
        aria-hidden
      />
      <p className="min-w-0 flex-1 break-words leading-snug font-medium">{message}</p>
    </div>
  );
});

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const dismissTimerRef = useRef(null);

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearDismissTimer();
    setToast(null);
  }, [clearDismissTimer]);

  const showToast = useCallback((type, text, options = {}) => {
    clearDismissTimer();
    setToast({ type, text });
    if (type !== 'loading') {
      const durationMs = options.durationMs
        ?? (type === 'error' ? TOAST_ERROR_DURATION_MS : TOAST_DURATION_MS);
      dismissTimerRef.current = window.setTimeout(dismiss, durationMs);
    }
  }, [clearDismissTimer, dismiss]);

  const contextValue = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {toast
        && createPortal(
          <div className="pointer-events-none fixed top-6 left-1/2 z-[200] -translate-x-1/2">
            <ToastItem message={toast.text} type={toast.type} />
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
