import { useState, useCallback, useEffect, useRef, memo, lazy, Suspense } from 'react';
import { FileText, Files, GitBranch, FolderPlus, Plus, PanelLeftClose, PanelLeft, Loader2, Terminal } from 'lucide-react';
import WorkspaceFileTree from './WorkspaceFileTree';
import EditorTabs from './EditorTabs';
import CodeEditor from './CodeEditorLazy';
import { ConsoleDialogShell } from './ConsoleDialog';
import SourceControlPanel from './SourceControlPanel';
import { consoleButtonFocusClass, consoleInputClass } from '@/lib/consoleTheme';
import { buttonClass } from '@/lib/buttonStyles';

const DiffViewer = lazy(() => import('./DiffViewer'));

function DiffViewerFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
    </div>
  );
}

const WorkspacePanel = memo(function WorkspacePanel({
  projectId,
  tabs,
  activePath,
  onSelectTab,
  onCloseTab,
  onSaveTab,
  onOpenFile,
  onFetchDir,
  onCreateFile,
  onCreateDir,
  onShowDiff,
  diffView,
  onCloseDiff,
  gitChanges,
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
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const stored = sessionStorage.getItem('xe_sidebar_open');
    return stored !== null ? stored === 'true' : true;
  });
  const [mainTab, setMainTab] = useState(() => {
    const stored = sessionStorage.getItem('xe_main_tab');
    return stored || 'files';
  });
  const newFileInputRef = useRef(null);
  const newFolderInputRef = useRef(null);

  useEffect(() => {
    sessionStorage.setItem('xe_sidebar_open', String(sidebarOpen));
  }, [sidebarOpen]);

  useEffect(() => {
    sessionStorage.setItem('xe_main_tab', mainTab);
  }, [mainTab]);

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
    if (mainTab === 'shell') {
      onShellMount?.();
    }
  }, [mainTab, onShellMount]);

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

  const handleSave = useCallback(async (path) => {
    setSaving(true);
    try {
      await onSaveTab?.(path);
    } finally {
      setSaving(false);
    }
  }, [onSaveTab]);

  const activeTab = tabs.find((t) => t.path === activePath);
  const activePathRef = useRef(activePath);
  activePathRef.current = activePath;

  const gitStagedFiles = gitChanges?.stagedFiles || [];
  const gitUnstagedFiles = gitChanges?.unstagedFiles || [];
  const gitHasChanges = gitStagedFiles.length + gitUnstagedFiles.length > 0;

  const MAIN_TABS = [
    { key: 'files', label: 'File', icon: Files },
    { key: 'git', label: 'Git', icon: GitBranch, badge: gitHasChanges ? gitStagedFiles.length + gitUnstagedFiles.length : 0 },
    { key: 'shell', label: 'Shell', icon: Terminal },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="workspace-panel">
      {/* Top-level tab bar */}
      <div className="flex items-center border-b border-[#E8EAED] px-1 shrink-0 bg-white">
        <div className="flex">
          {MAIN_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = mainTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setMainTab(tab.key)}
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
            );
          })}
        </div>
        {mainTab === 'files' && (
          <div className="flex items-center gap-0.5 ml-auto pr-1">
            <button title="新建文件" onClick={() => { setNewName(''); setShowNewFile(true); }}
              className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}>
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button title="新建文件夹" onClick={() => { setNewName(''); setShowNewFolder(true); }}
              className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}>
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
            {sidebarOpen && (
              <button title="收起侧栏" onClick={() => setSidebarOpen(false)}
                className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}>
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 flex">
        {mainTab === 'files' && (
          <>
            {sidebarOpen && (
              <div className="w-56 shrink-0 border-r border-[#E8EAED] bg-[#F4F5F6] flex flex-col min-h-0">
                <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1">
                  <WorkspaceFileTree lazy projectId={projectId} onFetchDir={onFetchDir}
                    selectedPath={activePath} onOpenFile={onOpenFile} />
                </div>
              </div>
            )}
            {!sidebarOpen && (
              <button
                title="展开侧栏"
                onClick={() => setSidebarOpen(true)}
                className={`shrink-0 p-1.5 border-r border-[#E8EAED] text-zinc-400 hover:text-zinc-600 hover:bg-[#F4F5F6] ${consoleButtonFocusClass}`}
              >
                <PanelLeft className="h-4 w-4" />
              </button>
            )}
            <div className="flex-1 min-w-0 flex flex-col min-h-0">
              {gitDiffView ? (
                <Suspense fallback={<DiffViewerFallback />}>
                  <DiffViewer
                    original={gitDiffView.original}
                    modified={gitDiffView.modified}
                    path={gitDiffView.path}
                    loading={gitDiffView.loading}
                    onClose={onCloseGitDiff}
                  />
                </Suspense>
              ) : tabs.length > 0 ? (
                <>
                  <EditorTabs
                    tabs={tabs}
                    activePath={activePath}
                    onSelectTab={onSelectTab}
                    onCloseTab={onCloseTab}
                    onSaveTab={handleSave}
                  />
                  <div className="flex-1 min-h-0 overflow-hidden">
                    {activeTab && (
                      <CodeEditor
                        content={activeTab.content}
                        originalContent={activeTab.originalContent}
                        path={activeTab.path}
                        isBinary={activeTab.isBinary}
                        readOnly={activeTab.isBinary}
                        saving={saving}
                        onSave={() => handleSave(activeTab.path)}
                        onChange={(value) => {
                          const currentPath = activePathRef.current;
                          onSelectTab?.(currentPath, value);
                        }}
                      />
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-400">
                  <FileText className="h-12 w-12" />
                  <p className="text-sm">从左侧文件树选择一个文件打开</p>
                </div>
              )}
            </div>
          </>
        )}

        {mainTab === 'git' && (
          <SourceControlPanel
            projectId={projectId}
            gitChanges={gitChanges}
            onGitFileClick={onGitFileClick}
            onCollapse={() => {}}
            provider={provider}
            sessionLive={sessionLive}
          />
        )}

        {mainTab === 'shell' && (
          <div className="flex-1 min-h-0 overflow-hidden">
            {shellContent || (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-400 h-full">
                <Terminal className="h-12 w-12" />
                <p className="text-sm">Shell terminal</p>
              </div>
            )}
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