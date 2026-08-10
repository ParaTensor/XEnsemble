import { useState, memo } from 'react';
import { FileDiff, X } from 'lucide-react';
import { ConsoleDialogShell } from './ConsoleDialog';
import { consoleButtonFocusClass } from '@/lib/consoleTheme';
import { buttonClass } from '@/lib/buttonStyles';

const EditorTabs = memo(function EditorTabs({ tabs, activePath, onSelectTab, onCloseTab, onSaveTab, onShowDiff }) {
  const [closingTab, setClosingTab] = useState(null);

  const handleClose = (path) => {
    const tab = tabs.find((t) => t.path === path);
    if (!tab) return;
    const dirty = tab.content !== tab.originalContent;
    if (dirty) {
      setClosingTab(path);
      return;
    }
    onCloseTab?.(path);
  };

  const handleSaveAndClose = async () => {
    if (!closingTab) return;
    try {
      await onSaveTab?.(closingTab);
      onCloseTab?.(closingTab);
    } catch (_) {
      // Keep tab on save failure
    }
    setClosingTab(null);
  };

  const handleDiscardAndClose = () => {
    if (closingTab) {
      onCloseTab?.(closingTab);
    }
    setClosingTab(null);
  };

  const handleCancelClose = () => {
    setClosingTab(null);
  };

  const activeTab = tabs.find((t) => t.path === activePath);
  const canDiff = activeTab && activeTab.content !== activeTab.originalContent && !activeTab.isBinary;

  return (
    <>
      <div className="flex items-center border-b border-[#E8EAED] bg-[#FAFBFC] overflow-x-auto" data-testid="tab-list">
        {tabs.map((tab) => {
          const dirty = tab.content !== tab.originalContent;
          const isActive = tab.path === activePath;
          const displayName = tab.path.split('/').pop();
          return (
            <div
              key={tab.path}
              data-testid="tab"
              data-dirty={dirty ? 'true' : 'false'}
              data-active={isActive ? 'true' : 'false'}
              className={`group flex items-center gap-1.5 shrink-0 px-3 py-2 text-sm cursor-pointer border-r border-[#E8EAED] transition-colors duration-150 ${
                isActive
                  ? 'bg-white text-[#202124] border-b-2 border-b-[#5B8DB8] -mb-px'
                  : 'text-[#5F6368] hover:bg-[#F4F5F6]'
              }`}
              onClick={() => onSelectTab?.(tab.path)}
            >
              <span className="truncate max-w-[160px]">{displayName}</span>
              {dirty && <span className="text-[#C06C5D] text-xs leading-none">&#x2022;</span>}
              <button
                aria-label={`Close ${tab.path}`}
                className={`ml-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-[#E8EAED] transition-opacity ${consoleButtonFocusClass}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleClose(tab.path);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        {canDiff && (
          <button
            title="Compare saved version"
            onClick={() => onShowDiff?.(activeTab.path)}
            disabled={!canDiff}
            className={`ml-auto shrink-0 inline-flex items-center gap-1.5 text-xs px-3 py-2 text-[#5B8DB8] hover:bg-[#F4F5F6] transition-colors ${consoleButtonFocusClass} ${!canDiff ? 'opacity-40 pointer-events-none' : ''}`}
          >
            <FileDiff className="h-3.5 w-3.5" />
            Compare saved version
          </button>
        )}
      </div>
      {closingTab && (
        <ConsoleDialogShell
          onClose={handleCancelClose}
          panelClassName="max-w-sm"
        >
          <div className="p-4">
            <h3 className="font-bold text-lg text-zinc-900 mb-2">Unsaved Changes</h3>
            <p className="text-sm text-zinc-500 mb-4">
              This file has unsaved changes. Close without saving?
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={handleCancelClose} className={buttonClass('secondary', 'sm')}>
                Cancel
              </button>
              <button onClick={handleDiscardAndClose} className={buttonClass('secondary', 'sm')}>
                Don't Save
              </button>
              <button onClick={handleSaveAndClose} className={buttonClass('primary', 'sm')}>
                Save
              </button>
            </div>
          </div>
        </ConsoleDialogShell>
      )}
    </>
  );
});

export default EditorTabs;
