import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils';
import {
  consoleBackdropClass,
  consoleDialogPanelClass,
  consoleStructuredDialogBodyClass,
  consoleStructuredDialogFooterClass,
  consoleStructuredDialogHeaderClass,
  textPrimary,
  textPlaceholder,
} from '../lib/consoleTheme';

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

/** ParaRouter structured dialog sections — DESIGN.md § Modals / Dialogs */
export function ConsoleStructuredDialogHeader({ title, subtitle, className, children }) {
  return (
    <div className={cn(consoleStructuredDialogHeaderClass, className)}>
      {children ?? (
        <div>
          <h3 className={`font-bold text-lg ${textPrimary}`}>{title}</h3>
          {subtitle ? <p className={`text-xs ${textPlaceholder} mt-0.5`}>{subtitle}</p> : null}
        </div>
      )}
    </div>
  );
}

export function ConsoleStructuredDialogBody({ className, children }) {
  return (
    <div className={cn(consoleStructuredDialogBodyClass, className)}>
      {children}
    </div>
  );
}

export function ConsoleStructuredDialogFooter({ className, children }) {
  return (
    <div className={cn(consoleStructuredDialogFooterClass, className)}>
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
  overlayClassName = 'fixed inset-0 z-[60] bg-black/50',
  panelClassName,
  children,
}) {
  useConsoleDialogEscape(onClose);

  return createPortal(
    (
      <>
        <div className={overlayClassName} aria-hidden onClick={onClose} />
        <div className="fixed inset-0 z-[61] flex items-center justify-center p-4 pointer-events-none">
          <div className={cn('pointer-events-auto', panelClassName)}>{children}</div>
        </div>
      </>
    ),
    document.body,
  );
}

function computeAnchoredPanelPosition(anchorRect, panelRect, { placement = 'top', align = 'end', gap = 8, padding = 12 } = {}) {
  let top = placement === 'top'
    ? anchorRect.top - panelRect.height - gap
    : anchorRect.bottom + gap;

  if (placement === 'top' && top < padding) {
    top = anchorRect.bottom + gap;
  } else if (placement === 'bottom' && top + panelRect.height > window.innerHeight - padding) {
    top = anchorRect.top - panelRect.height - gap;
  }

  let left = align === 'end'
    ? anchorRect.right - panelRect.width
    : align === 'center'
      ? anchorRect.left + (anchorRect.width - panelRect.width) / 2
      : anchorRect.left;

  left = Math.max(padding, Math.min(left, window.innerWidth - panelRect.width - padding));
  top = Math.max(padding, Math.min(top, window.innerHeight - panelRect.height - padding));

  return { top, left };
}

/** Anchored confirm dialog near a sidebar action (e.g. delete). */
export function ConsoleAnchoredDialog({
  onClose,
  anchorRect,
  placement = 'top',
  align = 'end',
  panelClassName,
  children,
}) {
  const panelRef = useRef(null);
  const [position, setPosition] = useState(null);

  useConsoleDialogEscape(onClose, Boolean(anchorRect));

  const updatePosition = () => {
    if (!anchorRect || !panelRef.current) return;
    const panelRect = panelRef.current.getBoundingClientRect();
    setPosition(computeAnchoredPanelPosition(anchorRect, panelRect, { placement, align }));
  };

  useLayoutEffect(() => {
    if (!anchorRect) {
      setPosition(null);
      return;
    }
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRect, placement, align, children]);

  if (!anchorRect) return null;

  return createPortal(
    (
      <>
        <div className="fixed inset-0 z-[60] bg-black/50" aria-hidden onClick={onClose} />
        <div
          ref={panelRef}
          className={cn('fixed z-[61]', panelClassName, !position && 'invisible')}
          style={position ? { top: position.top, left: position.left } : { top: anchorRect.top, left: anchorRect.left }}
          role="dialog"
          aria-modal="true"
        >
          {children}
        </div>
      </>
    ),
    document.body,
  );
}
