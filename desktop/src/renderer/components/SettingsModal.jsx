import React from 'react';
import { X } from 'lucide-react';
import { ConsoleDialogShell } from './ConsoleDialog';
import { consoleDialogPanelClass } from '../lib/consoleTheme';
import SettingsShell from './settings/SettingsShell';

export default function SettingsModal({ onClose }) {
  return (
    <ConsoleDialogShell
      onClose={onClose}
      panelClassName={`${consoleDialogPanelClass} w-[800px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-2rem)]`}
      panelProps={{ 'aria-labelledby': 'settings-modal-title' }}
    >
      <div className="flex items-center justify-between px-5 pt-3 pb-1 shrink-0">
        <h2 id="settings-modal-title" className="font-bold text-lg text-[#202124]">
          Settings
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="flex items-center justify-center w-8 h-8 rounded-md text-[#5F6368] hover:bg-[#E8EAED] hover:text-[#202124] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 px-5 py-3 overflow-hidden">
        <SettingsShell />
      </div>
    </ConsoleDialogShell>
  );
}
