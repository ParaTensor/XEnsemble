import { useState, useCallback, useEffect, useRef } from 'react';
import { FileText, FolderPlus, Plus, PanelLeftClose, PanelLeft } from 'lucide-react';
import WorkspaceFileTree from './WorkspaceFileTree';
import EditorTabs from './EditorTabs';
import CodeEditor from './CodeEditorLazy';
import DiffViewer from './DiffViewer';
import { ConsoleDialogShell } from './ConsoleDialog';
import { consoleButtonFocusClass, consoleInputClass } from '@/lib/consoleTheme';
import { buttonClass } from '@/lib/buttonStyles';

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
  const newFileInputRef = useRef(null);
  const newFolderInputRef = useRef(null);

  useEffect(() => {
    sessionStorage.setItem('xe_sidebar_open', String(sidebarOpen));
  }, [sidebarOpen]);

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

  return (
    <div className="flex h-full min-h-0" data-testid="workspace-panel">
      {sidebarOpen && (
        <div className="w-64 shrink-0 border-r border-[#E8EAED] bg-[#F4F5F6] flex flex-col min-h-0">
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
                    // 修复：将编辑器新内容传回父组件更新 tab.content
                    onSelectTab?.(activeTab.path, value);
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
