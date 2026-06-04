import React from 'react';
import { cn } from '../lib/utils';
import { consoleBackdropClass, consoleDialogPanelClass } from '../lib/consoleTokens';

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
