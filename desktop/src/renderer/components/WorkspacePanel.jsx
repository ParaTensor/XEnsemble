import { useState, useCallback, useEffect, useRef, useMemo, memo, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import {
  FileText, Files, FolderPlus, Plus, PanelLeftClose, PanelLeft, Loader2,
  Terminal, Globe, Monitor, GitBranch, GitPullRequest, X, ArrowLeft,
} from 'lucide-react';
import WorkspaceFileTree from './WorkspaceFileTree';
import CodeEditor from './CodeEditorLazy';
import { ConsoleDialogShell } from './ConsoleDialog';
import SourceControlPanel from './SourceControlPanel';
import WorkspacePreviewPane from './WorkspacePreviewPane';
import WorkspaceBrowserPane from './WorkspaceBrowserPane';
import MergeRequestListPanel from './git/MergeRequestListPanel';
import CodeReviewPanel from './git/CodeReviewPanel';
import CreatePRDialog from './github/CreatePRDialog';
import {
  consoleButtonFocusClass,
  consoleInputClass,
  consoleDropdownPanelClass,
  consoleMenuDropdownZClass,
} from '@/lib/consoleTheme';
import { buttonClass } from '@/lib/buttonStyles';

const DiffViewer = lazy(() => import('./DiffViewer'));

function DiffViewerFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
    </div>
  );
}

const PINNED_TABS = [
  { key: 'files', label: 'Files', icon: Files },
  { key: 'changes', label: 'Changes', icon: GitBranch },
];

const ADDABLE_TABS = [
  { key: 'pullrequests', label: 'Pull Requests', icon: GitPullRequest },
  { key: 'terminal', label: 'Terminal', icon: Terminal },
  { key: 'preview', label: 'Preview', icon: Monitor },
  { key: 'browser', label: 'Browser', icon: Globe },
];

const ADDABLE_KEYS = new Set(ADDABLE_TABS.map((t) => t.key));

function migrateTabKey(key) {
  if (key === 'git') return 'changes';
  if (key === 'shell') return 'terminal';
  return key;
}

function readExtraTabs() {
  try {
    const raw = sessionStorage.getItem('xe_extra_tabs');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(migrateTabKey).filter((k) => ADDABLE_KEYS.has(k));
      }
    }
  } catch {
    // ignore
  }
  const legacy = migrateTabKey(sessionStorage.getItem('xe_main_tab') || '');
  return legacy && ADDABLE_KEYS.has(legacy) ? [legacy] : [];
}

function readMainTab(extraTabs) {
  const stored = migrateTabKey(sessionStorage.getItem('xe_main_tab') || 'files');
  if (stored === 'files' || stored === 'changes') return stored;
  if (extraTabs.includes(stored)) return stored;
  return 'files';
}

const WorkspacePanel = memo(function WorkspacePanel({
  projectId,
  tabs,
  activePath,
  onSelectTab,
  onSaveTab,
  onOpenFile,
  onFetchDir,
  onCreateFile,
  onCreateDir,
  onShowDiff,
  diffView,
  onCloseDiff,
  gitChanges,
  changesTabActiveRef,
  onGitFileClick,
  gitDiffView,
  onCloseGitDiff,
  provider,
  sessionLive,
  shellContent,
  onShellMount,
}) {
  const [showNewFile, setShowNewFile] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createPROpen, setCreatePROpen] = useState(false);
  const [selectedMR, setSelectedMR] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const stored = sessionStorage.getItem('xe_sidebar_open');
    return stored !== null ? stored === 'true' : true;
  });
  const [extraTabs, setExtraTabs] = useState(readExtraTabs);
  const [mainTab, setMainTab] = useState(() => readMainTab(readExtraTabs()));
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMenuRect, setAddMenuRect] = useState(null);
  const addBtnRef = useRef(null);
  const newFileInputRef = useRef(null);
  const newFolderInputRef = useRef(null);

  useEffect(() => {
    sessionStorage.setItem('xe_sidebar_open', String(sidebarOpen));
  }, [sidebarOpen]);

  useEffect(() => {
    sessionStorage.setItem('xe_main_tab', mainTab);
    if (changesTabActiveRef) changesTabActiveRef.current = (mainTab === 'changes');
  }, [mainTab, changesTabActiveRef]);

  useEffect(() => {
    sessionStorage.setItem('xe_extra_tabs', JSON.stringify(extraTabs));
  }, [extraTabs]);

  useEffect(() => {
    if (showNewFile && newFileInputRef.current) {
      newFileInputRef.current.focus();
    }
  }, [showNewFile]);

  useEffect(() => {
    if (showNewFolder && newFolderInputRef.current) {
      newFolderInputRef.current.focus();
    }
  }, [showNewFolder]);

  useEffect(() => {
    if (mainTab === 'terminal') {
      onShellMount?.();
    }
  }, [mainTab, onShellMount]);

  const fetchGitStatus = gitChanges?.fetchStatus;

  useEffect(() => {
    if (!addMenuOpen) {
      setAddMenuRect(null);
      return undefined;
    }
    const update = () => {
      const el = addBtnRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setAddMenuRect({ top: rect.bottom + 4, left: rect.left, width: 200 });
    };
    update();
    const onDoc = (e) => {
      if (addBtnRef.current?.contains(e.target)) return;
      const menu = document.getElementById('workspace-add-menu');
      if (menu?.contains(e.target)) return;
      setAddMenuOpen(false);
    };
    window.addEventListener('resize', update);
    document.addEventListener('mousedown', onDoc);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [addMenuOpen]);

  const handleCreateFile = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await onCreateFile?.(projectId, newName.trim());
      setShowNewFile(false);
      setNewName('');
    } finally {
      setCreating(false);
    }
  }, [newName, projectId, onCreateFile]);

  const handleCreateDir = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await onCreateDir?.(projectId, newName.trim());
      setShowNewFolder(false);
      setNewName('');
    } finally {
      setCreating(false);
    }
  }, [newName, projectId, onCreateDir]);

  const autosaveTimerRef = useRef(null);
  const pendingAutosavePathRef = useRef(null);

  const handleSave = useCallback(async (path) => {
    if (!path) return;
    setSaving(true);
    try {
      await onSaveTab?.(path);
    } finally {
      setSaving(false);
    }
  }, [onSaveTab]);

  const flushAutosave = useCallback(async () => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    const path = pendingAutosavePathRef.current;
    pendingAutosavePathRef.current = null;
    if (path) await handleSave(path);
  }, [handleSave]);

  const scheduleAutosave = useCallback((path) => {
    if (!path) return;
    pendingAutosavePathRef.current = path;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      const pendingPath = pendingAutosavePathRef.current;
      pendingAutosavePathRef.current = null;
      if (pendingPath) handleSave(pendingPath).catch(() => {});
    }, 500);
  }, [handleSave]);

  useEffect(() => () => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
  }, []);

  const handleOpenFile = useCallback(async (file) => {
    await flushAutosave();
    return onOpenFile?.(file);
  }, [flushAutosave, onOpenFile]);

  const handleImmediateSave = useCallback(async (path) => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    pendingAutosavePathRef.current = null;
    await handleSave(path);
  }, [handleSave]);

  const selectMainTab = useCallback(async (key) => {
    if (key === 'changes') {
      await flushAutosave().catch(() => {});
      await fetchGitStatus?.({ silent: true, skipIfFreshMs: 2000 });
    }
    setMainTab(key);
  }, [flushAutosave, fetchGitStatus]);

  const addTab = useCallback((key) => {
    setExtraTabs((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setMainTab(key);
    setAddMenuOpen(false);
  }, []);

  const closeExtraTab = useCallback((key) => {
    setExtraTabs((prev) => prev.filter((k) => k !== key));
    setMainTab((current) => (current === key ? 'files' : current));
  }, []);

  const activeTab = tabs.find((t) => t.path === activePath);
  const activePathRef = useRef(activePath);
  activePathRef.current = activePath;

  const gitStagedFiles = gitChanges?.stagedFiles || [];
  const gitUnstagedFiles = gitChanges?.unstagedFiles || [];
  const changeCount = gitStagedFiles.length + gitUnstagedFiles.length;

  const isExternalGit = provider && provider !== 'none' && provider !== 'local_git';

  const visibleTabs = useMemo(() => {
    const pinned = PINNED_TABS.map((t) => (
      t.key === 'changes' ? { ...t, badge: changeCount } : t
    ));
    const extras = extraTabs
      .map((key) => ADDABLE_TABS.find((t) => t.key === key))
      .filter((t) => {
        if (!t) return false;
        if (t.key === 'pullrequests') return isExternalGit;
        return true;
      });
    return [
      ...pinned,
      ...extras,
    ];
  }, [extraTabs, changeCount, isExternalGit]);

  const addableRemaining = ADDABLE_TABS.filter((t) => {
    if (extraTabs.includes(t.key)) return false;
    if (t.key === 'pullrequests') return isExternalGit;
    return true;
  });

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="workspace-panel">
      <div className="flex items-center border-b border-[#E8EAED] px-1 shrink-0 bg-white">
        <div className="flex min-w-0 items-center overflow-x-auto console-scroll-hidden">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = mainTab === tab.key;
            const closable = ADDABLE_KEYS.has(tab.key);
            return (
              <div key={tab.key} className="relative flex items-center group">
                <button
                  type="button"
                  onClick={() => { void selectMainTab(tab.key); }}
                  className={`relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                    isActive
                      ? 'border-[#202124] text-[#202124]'
                      : 'border-transparent text-[#5F6368] hover:text-[#202124]'
                  } ${consoleButtonFocusClass}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                  {tab.badge > 0 && (
                    <span className="ml-0.5 inline-flex items-center justify-center h-3.5 min-w-[14px] rounded-full bg-[#C06C5D] text-white text-[9px] font-medium px-1">
                      {tab.badge > 9 ? '9+' : tab.badge}
                    </span>
                  )}
                </button>
                {closable && (
                  <button
                    type="button"
                    title={`Close ${tab.label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeExtraTab(tab.key);
                    }}
                    className={`absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-400 hover:text-zinc-700 hover:bg-[#E8EAED] opacity-0 group-hover:opacity-100 ${consoleButtonFocusClass}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
          <button
            ref={addBtnRef}
            type="button"
            title="Add panel"
            onClick={() => setAddMenuOpen((v) => !v)}
            className={`ml-0.5 p-1.5 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {mainTab === 'files' && (
          <div className="flex items-center gap-0.5 ml-auto pr-1">
            <button title="New file" onClick={() => { setNewName(''); setShowNewFile(true); }}
              className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}>
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button title="New folder" onClick={() => { setNewName(''); setShowNewFolder(true); }}
              className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}>
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
            <button
              title={sidebarOpen ? 'Collapse file tree' : 'Expand file tree'}
              onClick={() => setSidebarOpen((open) => !open)}
              className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}
            >
              {sidebarOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeft className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
      </div>

      {addMenuOpen && addMenuRect && createPortal(
        <div
          id="workspace-add-menu"
          className={`fixed ${consoleMenuDropdownZClass} ${consoleDropdownPanelClass} py-1 shadow-lg`}
          style={{ top: addMenuRect.top, left: addMenuRect.left, width: addMenuRect.width }}
          role="menu"
        >
          {addableRemaining.map((tab) => {
            const Icon = tab.icon;
            const alreadyOpen = extraTabs.includes(tab.key);
            return (
              <button
                key={tab.key}
                type="button"
                role="menuitem"
                disabled={alreadyOpen}
                onClick={() => addTab(tab.key)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  alreadyOpen
                    ? 'text-zinc-400 cursor-default'
                    : 'text-zinc-700 hover:bg-zinc-50'
                } ${consoleButtonFocusClass}`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{tab.label}</span>
                {alreadyOpen && <span className="ml-auto text-[10px] text-zinc-400">已打开</span>}
              </button>
            );
          })}
          {addableRemaining.length === 0 && (
            <div className="px-3 py-2 text-xs text-zinc-400">全部面板已打开</div>
          )}
        </div>,
        document.body,
      )}

      <div className="flex-1 min-h-0 flex">
        {mainTab === 'files' && (
          <>
            {sidebarOpen && (
              <div className="w-44 shrink-0 border-r border-[#E8EAED] bg-[#F4F5F6] flex flex-col min-h-0">
                <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1">
                  <WorkspaceFileTree lazy projectId={projectId} onFetchDir={onFetchDir}
                    selectedPath={activePath} onOpenFile={handleOpenFile} />
                </div>
              </div>
            )}
            <div className="flex-1 min-w-0 flex flex-col min-h-0">
              {gitDiffView ? (
                <Suspense fallback={<DiffViewerFallback />}>
                  <DiffViewer
                    original={gitDiffView.original}
                    modified={gitDiffView.modified}
                    path={gitDiffView.path}
                    loading={gitDiffView.loading}
                    binary={gitDiffView.binary}
                    truncated={gitDiffView.truncated}
                    onClose={onCloseGitDiff}
                  />
                </Suspense>
              ) : activeTab ? (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <CodeEditor
                    content={activeTab.content}
                    path={activeTab.path}
                    isBinary={activeTab.isBinary}
                    readOnly={activeTab.isBinary}
                    saving={saving}
                    onSave={() => handleImmediateSave(activeTab.path)}
                    onChange={(value) => {
                      const currentPath = activePathRef.current;
                      onSelectTab?.(currentPath, value);
                      scheduleAutosave(currentPath);
                    }}
                  />
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-400">
                  <FileText className="h-12 w-12" />
                  <p className="text-sm">从左侧文件树选择一个文件打开</p>
                </div>
              )}
            </div>
          </>
        )}

        {mainTab === 'changes' && (
          <SourceControlPanel
            projectId={projectId}
            gitChanges={gitChanges}
            onGitFileClick={onGitFileClick}
            onJumpToFile={(filePath) => {
              setMainTab('files');
              handleOpenFile?.({ path: filePath, type: 'file' });
            }}
            provider={provider}
            sessionLive={sessionLive}
          />
        )}

        {mainTab === 'pullrequests' && (
          <div className="flex-1 min-h-0 flex flex-col">
            {selectedMR ? (
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="flex items-center gap-2 border-b border-[#E8EAED] px-3 py-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSelectedMR(null)}
                    title="Back to list"
                    className={`p-1 rounded text-[#5F6368] hover:text-[#202124] hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="text-xs font-medium text-[#202124] truncate">
                    #{selectedMR.remote_mr_number || selectedMR.remoteMrNumber || ''} {selectedMR.title}
                  </span>
                </div>
                <div className="flex-1 min-h-0">
                  <CodeReviewPanel
                    projectId={projectId}
                    mergeRequestId={selectedMR.id}
                    mergeRequest={selectedMR}
                  />
                </div>
              </div>
            ) : (
              <>
                <MergeRequestListPanel
                  projectId={projectId}
                  provider={provider}
                  onSelectMR={setSelectedMR}
                />
                <div className="flex items-center justify-end gap-2 border-t border-[#E8EAED] px-3 py-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setCreatePROpen(true)}
                    className={`${buttonClass('primary', 'sm')}`}
                  >
                    <GitPullRequest className="h-3.5 w-3.5 mr-1 inline" />
                    New Pull Request
                  </button>
                </div>
              </>
            )}
            <CreatePRDialog
              open={createPROpen}
              projectId={projectId}
              sourceBranch={gitChanges?.branch || ''}
              defaultTargetBranch="main"
              onClose={() => setCreatePROpen(false)}
            />
          </div>
        )}

        {mainTab === 'terminal' && (
          <div className="flex-1 min-h-0 overflow-hidden">
            {shellContent || (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-400 h-full">
                <Terminal className="h-12 w-12" />
                <p className="text-sm">Terminal</p>
              </div>
            )}
          </div>
        )}

        {mainTab === 'preview' && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <WorkspacePreviewPane projectId={projectId} />
          </div>
        )}

        {mainTab === 'browser' && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <WorkspaceBrowserPane />
          </div>
        )}
      </div>

      {showNewFile && (
        <ConsoleDialogShell onClose={() => setShowNewFile(false)}>
          <div className="p-4 w-80">
            <h3 className="font-bold text-lg text-zinc-900 mb-3">新建文件</h3>
            <input ref={newFileInputRef} type="text" placeholder="文件名.js"
              value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFile(); }}
              className={consoleInputClass} />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowNewFile(false)} className={buttonClass('secondary', 'sm')}>取消</button>
              <button onClick={handleCreateFile} disabled={creating || !newName.trim()} className={buttonClass('primary', 'sm')}>
                {creating ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </ConsoleDialogShell>
      )}

      {showNewFolder && (
        <ConsoleDialogShell onClose={() => setShowNewFolder(false)}>
          <div className="p-4 w-80">
            <h3 className="font-bold text-lg text-zinc-900 mb-3">新建文件夹</h3>
            <input ref={newFolderInputRef} type="text" placeholder="文件夹名"
              value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateDir(); }}
              className={consoleInputClass} />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowNewFolder(false)} className={buttonClass('secondary', 'sm')}>取消</button>
              <button onClick={handleCreateDir} disabled={creating || !newName.trim()} className={buttonClass('primary', 'sm')}>
                {creating ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </ConsoleDialogShell>
      )}
    </div>
  );
});

export default WorkspacePanel;
