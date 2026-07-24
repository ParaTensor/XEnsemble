import { useState, useCallback, useEffect, useRef, memo, lazy, Suspense } from 'react';
import { FileText, Files, GitBranch, FolderPlus, Plus, PanelLeftClose, PanelLeft, Loader2 } from 'lucide-react';
import WorkspaceFileTree from './WorkspaceFileTree';
import EditorTabs from './EditorTabs';
import CodeEditor from './CodeEditorLazy';
import { ConsoleDialogShell } from './ConsoleDialog';
import SourceControlPanel from './SourceControlPanel';
import { consoleButtonFocusClass, consoleInputClass } from '@/lib/consoleTheme';
import { buttonClass } from '@/lib/buttonStyles';

// Lazy-load DiffViewer (Monaco diff module) only when a diff is actually viewed.
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
  const [sidebarTab, setSidebarTab] = useState(() => {
    const stored = sessionStorage.getItem('xe_sidebar_tab');
    return stored || 'files';
  });
  const newFileInputRef = useRef(null);
  const newFolderInputRef = useRef(null);

  useEffect(() => {
    sessionStorage.setItem('xe_sidebar_open', String(sidebarOpen));
  }, [sidebarOpen]);

  useEffect(() => {
    sessionStorage.setItem('xe_sidebar_tab', sidebarTab);
  }, [sidebarTab]);

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

  const activityBar = (
    <div className="w-12 shrink-0 border-r border-[#E8EAED] bg-[#F4F5F6] flex flex-col items-center py-2 gap-1">
      <button
        title="文件"
        onClick={() => setSidebarTab(sidebarTab === 'files' && sidebarOpen ? 'files' : 'files')}
        className={`relative w-10 h-10 flex items-center justify-center rounded-md transition-colors ${
          sidebarTab === 'files' && sidebarOpen
            ? 'text-[#202124] bg-white shadow-sm'
            : 'text-[#9AA0A6] hover:text-[#5F6368] hover:bg-[#E8EAED]'
        } ${consoleButtonFocusClass}`}
      >
        <Files className="h-5 w-5" />
      </button>
      <button
        title={`源代码管理${gitHasChanges ? ` (${gitStagedFiles.length + gitUnstagedFiles.length})` : ''}`}
        onClick={() => setSidebarTab(sidebarTab === 'changes' && sidebarOpen ? 'files' : 'changes')}
        className={`relative w-10 h-10 flex items-center justify-center rounded-md transition-colors ${
          sidebarTab === 'changes' && sidebarOpen
            ? 'text-[#202124] bg-white shadow-sm'
            : 'text-[#9AA0A6] hover:text-[#5F6368] hover:bg-[#E8EAED]'
        } ${consoleButtonFocusClass}`}
      >
        <GitBranch className="h-5 w-5" />
        {gitHasChanges && (
          <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-[#C06C5D] text-white text-[8px] flex items-center justify-center leading-none">
            {gitStagedFiles.length + gitUnstagedFiles.length > 9 ? '9+' : gitStagedFiles.length + gitUnstagedFiles.length}
          </span>
        )}
      </button>
    </div>
  );

  const renderPanel = () => {
    if (sidebarTab === 'changes') {
      return (
        <SourceControlPanel
          projectId={projectId}
          gitChanges={gitChanges}
          onGitFileClick={onGitFileClick}
          onCollapse={() => setSidebarOpen(false)}
          provider={provider}
          sessionLive={sessionLive}
        />
      );
    }

    // 文件管理面板
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#E8EAED]">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">文件</span>
          <div className="flex items-center gap-1">
            <button title="新建文件" onClick={() => { setNewName(''); setShowNewFile(true); }}
              className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}>
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button title="新建文件夹" onClick={() => { setNewName(''); setShowNewFolder(true); }}
              className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}>
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
            <button title="收起侧栏" onClick={() => setSidebarOpen(false)}
              className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}>
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1">
          <WorkspaceFileTree lazy projectId={projectId} onFetchDir={onFetchDir}
            selectedPath={activePath} onOpenFile={onOpenFile} />
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0" data-testid="workspace-panel">
      {sidebarOpen && (
        <>
          {activityBar}
          <div className="w-56 shrink-0 border-r border-[#E8EAED] bg-[#F4F5F6] flex flex-col min-h-0">
            {renderPanel()}
          </div>
        </>
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
        ) : diffView ? (
          <Suspense fallback={<DiffViewerFallback />}>
            <DiffViewer
              original={diffView.original}
              modified={diffView.modified}
              path={diffView.path}
              loading={diffView.loading}
              onClose={onCloseDiff}
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
              onShowDiff={onShowDiff}
            />
            <div className="flex-1 min-h-0 overflow-hidden">
              {activeTab && (
                <CodeEditor
                  content={activeTab.content}
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