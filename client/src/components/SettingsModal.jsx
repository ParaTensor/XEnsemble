import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { ConsoleDialogBackdrop, ConsoleDialogPanel } from './ConsoleDialog';
import SettingsShell from './settings/SettingsShell';

export default function SettingsModal({ onClose }) {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <>
      <ConsoleDialogBackdrop className="z-[100]" onClick={onClose} />
      <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
        <ConsoleDialogPanel
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-modal-title"
          className="pointer-events-auto w-[600px] h-[400px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)]"
        >
          <div className="flex items-center justify-between px-6 pt-4 pb-2 shrink-0">
            <h2 id="settings-modal-title" className="font-bold text-lg text-zinc-900">
              Settings
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="flex items-center justify-center w-8 h-8 rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 min-h-0 px-6 py-5 overflow-hidden">
            <SettingsShell />
          </div>
        </ConsoleDialogPanel>
      </div>
    </>
  );
}
