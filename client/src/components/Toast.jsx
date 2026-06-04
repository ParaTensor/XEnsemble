import React, { createContext, useCallback, useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { cn } from '../lib/utils';

const ToastContext = createContext(null);

const TOAST_DURATION_MS = 4000;

function ToastItem({ message, ok }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-none flex w-[min(22rem,calc(100vw-2rem))] items-start gap-2.5 rounded-xl border px-4 py-3 text-[13px] shadow-lg',
        ok ? 'border-emerald-200 bg-emerald-50/95 text-emerald-900' : 'border-red-200 bg-red-50/95 text-red-900',
      )}
    >
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
      ) : (
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
      )}
      <p className="min-w-0 flex-1 break-words leading-snug font-medium">{message}</p>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);

  const dismiss = useCallback(() => {
    setToast(null);
  }, []);

  const showToast = useCallback((type, text) => {
    const ok = type === 'success';
    setToast({ ok, text });
    window.setTimeout(dismiss, TOAST_DURATION_MS);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast
        && createPortal(
          <div className="pointer-events-none fixed top-6 left-1/2 z-[200] -translate-x-1/2">
            <ToastItem message={toast.text} ok={toast.ok} />
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
