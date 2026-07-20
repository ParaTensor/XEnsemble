import { useState, useCallback, useEffect, useRef } from 'react';
import { FileText, GitBranch, FolderPlus, Plus, PanelLeftClose, PanelLeft } from 'lucide-react';
import WorkspaceFileTree from './WorkspaceFileTree';
import EditorTabs from './EditorTabs';
import CodeEditor from './CodeEditorLazy';
import DiffViewer from './DiffViewer';
import { ConsoleDialogShell } from './ConsoleDialog';
import { consoleButtonFocusClass, consoleInputClass } from '@/lib/consoleTheme';
import { buttonClass } from '@/lib/buttonStyles';

const SIDEBAR_TABS = [
  { key: 'files', label: '文件' },
  { key: 'changes', label: '变更' },
];

export default function WorkspacePanel({
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
  useEffect(() => { activePathRef.current = activePath; }, [activePath]);

  const dirtyTabs = tabs.filter((t) => t.content !== t.originalContent && !t.isBinary);
  const dirtyCount = dirtyTabs.length;

  const handleChangeClick = useCallback((path) => {
    onSelectTab?.(path);
    onShowDiff?.(path);
  }, [onSelectTab, onShowDiff]);

  return (
    <div className="flex h-full min-h-0" data-testid="workspace-panel">
      {sidebarOpen && (
        <div className="w-64 shrink-0 border-r border-[#E8EAED] bg-[#F4F5F6] flex flex-col min-h-0">
          <div className="flex border-b border-[#E8EAED]">
            {SIDEBAR_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setSidebarTab(tab.key)}
                className={`flex-1 text-xs font-medium py-2 px-2 transition-colors border-b-2 ${
                  sidebarTab === tab.key
                    ? 'text-[#202124] border-[#5B8DB8] bg-white'
                    : 'text-[#5F6368] border-transparent hover:bg-[#E8EAED]'
                } ${consoleButtonFocusClass}`}
              >
                {tab.label}
                {tab.key === 'changes' && dirtyCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-[#C06C5D] text-white leading-none">
                    {dirtyCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {sidebarTab === 'files' ? (
            <>
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#E8EAED]">
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">文件</span>
                <div className="flex items-center gap-1">
                  <button
                    title="新建文件"
                    onClick={() => { setNewName(''); setShowNewFile(true); }}
                    className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    title="新建文件夹"
                    onClick={() => { setNewName(''); setShowNewFolder(true); }}
                    className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    title="收起侧栏"
                    onClick={() => setSidebarOpen(false)}
                    className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}
                  >
                    <PanelLeftClose className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1">
                <WorkspaceFileTree
                  lazy
                  projectId={projectId}
                  onFetchDir={onFetchDir}
                  selectedPath={activePath}
                  onOpenFile={onOpenFile}
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#E8EAED]">
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">变更</span>
                <button
                  title="收起侧栏"
                  onClick={() => setSidebarOpen(false)}
                  className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}
                >
                  <PanelLeftClose className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {dirtyTabs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-2 text-zinc-400">
                    <GitBranch className="h-8 w-8" />
                    <p className="text-xs">暂无未保存的变更</p>
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {dirtyTabs.map((tab) => (
                      <button
                        key={tab.path}
                        onClick={() => handleChangeClick(tab.path)}
                        className={`flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-[#E8EAED] ${
                          tab.path === activePath ? 'bg-[#E8EAED]' : ''
                        } ${consoleButtonFocusClass}`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-[#C06C5D] shrink-0" />
                        <span className="truncate text-[#202124]">{tab.path}</span>
                        <span className="ml-auto text-zinc-400 shrink-0">M</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
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
        {diffView ? (
          <DiffViewer
            original={diffView.original}
            modified={diffView.modified}
            path={diffView.path}
            loading={diffView.loading}
            onClose={onCloseDiff}
          />
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
            <input
              ref={newFileInputRef}
              type="text"
              placeholder="文件名.js"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFile(); }}
              className={consoleInputClass}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowNewFile(false)} className={buttonClass('secondary', 'sm')}>
                取消
              </button>
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
            <input
              ref={newFolderInputRef}
              type="text"
              placeholder="文件夹名"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateDir(); }}
              className={consoleInputClass}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowNewFolder(false)} className={buttonClass('secondary', 'sm')}>
                取消
              </button>
              <button onClick={handleCreateDir} disabled={creating || !newName.trim()} className={buttonClass('primary', 'sm')}>
                {creating ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </ConsoleDialogShell>
      )}
    </div>
  );
}