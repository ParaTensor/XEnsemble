import { createContext, useCallback, useContext, useMemo, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import { cn } from '../lib/utils';

const ToastContext = createContext(null);

const TOAST_DURATION_MS = 4000;
const TOAST_ERROR_DURATION_MS = 12000;

const ToastItem = memo(function ToastItem({ message, type }) {
  const styles = {
    success: 'border-emerald-500/50 bg-zinc-900 text-emerald-300 shadow-xl',
    error: 'border-red-500/50 bg-zinc-900 text-red-300 shadow-xl',
    warning: 'border-amber-500/50 bg-zinc-900 text-amber-300 shadow-xl',
    loading: 'border-blue-500/50 bg-zinc-900 text-blue-300 shadow-xl',
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
        'pointer-events-none flex w-[min(22rem,calc(100vw-2rem))] items-start gap-2.5 rounded-lg border px-4 py-3 text-xs font-medium shadow-xl',
        styles[type] || styles.error,
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          type === 'success' && 'text-emerald-400',
          type === 'error' && 'text-red-400',
          type === 'warning' && 'text-amber-400',
          type === 'loading' && 'animate-spin text-blue-400',
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
