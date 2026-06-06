import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils';
import { consoleBackdropClass, consoleDialogPanelClass } from '../lib/consoleTokens';

export function useConsoleDialogEscape(onClose, active = true) {
  useEffect(() => {
    if (!active || !onClose) return;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, active]);
}

export function ConsoleDialogBackdrop({ className, onClick }) {
  return (
    <div
      className={cn(consoleBackdropClass, className)}
      aria-hidden
      onClick={onClick}
    />
  );
}

export function ConsoleDialogPanel({ className, children, ...props }) {
  return (
    <div className={cn(consoleDialogPanelClass, className)} {...props}>
      {children}
    </div>
  );
}

/** Standard ConsoleDialog shell: backdrop + centered panel, Escape / backdrop close. */
export function ConsoleDialogShell({
  onClose,
  backdropClassName,
  shellClassName,
  panelClassName,
  panelProps,
  children,
  /** Content-sized panel: height follows children, no inner scroll container. */
  fitContent = false,
}) {
  useConsoleDialogEscape(onClose);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const resolvedShellClass = shellClassName
    ?? 'fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none';

  const panel = fitContent ? (
    <div
      className={cn('pointer-events-auto', panelClassName)}
      role="dialog"
      aria-modal="true"
      {...panelProps}
    >
      {children}
    </div>
  ) : (
    <ConsoleDialogPanel
      className={cn('pointer-events-auto', panelClassName)}
      role="dialog"
      aria-modal="true"
      {...panelProps}
    >
      {children}
    </ConsoleDialogPanel>
  );

  return createPortal(
    (
      <>
        <ConsoleDialogBackdrop className={cn('z-[100]', backdropClassName)} onClick={onClose} />
        <div className={resolvedShellClass}>
          {panel}
        </div>
      </>
    ),
    document.body,
  );
}

/** Inline overlay dialog (Console page confirm / launch modals). */
export function ConsoleInlineDialog({
  onClose,
  overlayClassName = 'fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4',
  panelClassName,
  children,
}) {
  useConsoleDialogEscape(onClose);

  return (
    <div className={overlayClassName}>
      <div className={panelClassName}>{children}</div>
    </div>
  );
}
