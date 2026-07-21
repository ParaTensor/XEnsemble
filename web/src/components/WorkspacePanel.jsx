import { useState, useCallback, useEffect, useRef } from 'react';
import { FileText, Files, GitBranch, GitCommit, FolderPlus, Plus, PanelLeftClose, PanelLeft, ArrowUp, ArrowDown, Loader2, RefreshCw, Minus } from 'lucide-react';
import WorkspaceFileTree from './WorkspaceFileTree';
import EditorTabs from './EditorTabs';
import CodeEditor from './CodeEditorLazy';
import DiffViewer from './DiffViewer';
import { ConsoleDialogShell } from './ConsoleDialog';
import { consoleButtonFocusClass, consoleInputClass } from '@/lib/consoleTheme';
import { buttonClass } from '@/lib/buttonStyles';

const GIT_STATUS_LABELS = {
  'M ': 'M', ' M': 'M', 'MM': 'M',
  'A ': 'A', 'AM': 'A',
  'D ': 'D',
  '??': 'U',
  'R ': 'R',
};

const GIT_STATUS_COLORS = {
  'M ': 'text-[#C06C5D]', ' M': 'text-[#C06C5D]', 'MM': 'text-[#C06C5D]',
  'A ': 'text-[#4A7C59]', 'AM': 'text-[#4A7C59]',
  'D ': 'text-[#C06C5D]',
  '??': 'text-[#4A7C59]',
  'R ': 'text-[#5B8DB8]',
};

const GIT_STATUS_DESC = {
  'M ': '修改', ' M': '修改', 'MM': '修改',
  'A ': '新增', 'AM': '新增',
  'D ': '删除',
  '??': '未跟踪',
  'R ': '重命名',
};

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
  gitChanges,
  onGitFileClick,
  gitDiffView,
  onCloseGitDiff,
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
  const [commitMessage, setCommitMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [showAuthorDialog, setShowAuthorDialog] = useState(false);
  const [authorName, setAuthorName] = useState(() => localStorage.getItem('xe_git_author_name') || '');
  const [authorEmail, setAuthorEmail] = useState(() => localStorage.getItem('xe_git_author_email') || '');
  const newFileInputRef = useRef(null);
  const newFolderInputRef = useRef(null);
  const authorNameRef = useRef(null);

  useEffect(() => {
    sessionStorage.setItem('xe_sidebar_open', String(sidebarOpen));
  }, [sidebarOpen]);

  useEffect(() => {
    sessionStorage.setItem('xe_sidebar_tab', sidebarTab);
  }, [sidebarTab]);

  useEffect(() => {
    if (showAuthorDialog && authorNameRef.current) {
      authorNameRef.current.focus();
    }
  }, [showAuthorDialog]);

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
  const branch = gitChanges?.branch || '';

  const handleStageAll = useCallback(async () => {
    const paths = gitUnstagedFiles.map((f) => f.path);
    if (paths.length === 0) return;
    await gitChanges?.stage(paths);
  }, [gitUnstagedFiles, gitChanges]);

  const handleUnstageAll = useCallback(async () => {
    const paths = gitStagedFiles.map((f) => f.path);
    if (paths.length === 0) return;
    await gitChanges?.unstage(paths);
  }, [gitStagedFiles, gitChanges]);

  const handleStageFile = useCallback(async (path) => {
    await gitChanges?.stage([path]);
  }, [gitChanges]);

  const handleUnstageFile = useCallback(async (path) => {
    await gitChanges?.unstage([path]);
  }, [gitChanges]);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) return;
    setCommitting(true);
    try {
      const author = authorName && authorEmail ? { name: authorName, email: authorEmail } : undefined;
      await gitChanges?.commit(commitMessage.trim(), author);
      setCommitMessage('');
    } catch (err) {
      if (err.code === 'AUTHOR_REQUIRED' || (err.message && err.message.includes('author'))) {
        setShowAuthorDialog(true);
        return;
      }
    } finally {
      setCommitting(false);
    }
  }, [commitMessage, gitChanges, authorName, authorEmail]);

  const handleAuthorConfirm = useCallback(async () => {
    if (!authorName.trim() || !authorEmail.trim()) return;
    localStorage.setItem('xe_git_author_name', authorName.trim());
    localStorage.setItem('xe_git_author_email', authorEmail.trim());
    setShowAuthorDialog(false);
    setCommitting(true);
    try {
      const author = { name: authorName.trim(), email: authorEmail.trim() };
      await gitChanges?.commit(commitMessage.trim(), author);
      setCommitMessage('');
    } catch (_) {
    } finally {
      setCommitting(false);
    }
  }, [commitMessage, gitChanges, authorName, authorEmail]);

  const renderGitFile = (f, stageAction) => {
    const label = GIT_STATUS_LABELS[f.status] || f.status;
    const colorCls = GIT_STATUS_COLORS[f.status] || 'text-zinc-400';
    const desc = GIT_STATUS_DESC[f.status] || '';
    const fileName = f.path.split('/').pop();
    const dirPath = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    return (
      <div key={f.path} className="flex items-center group hover:bg-[#E8EAED]">
        <button
          onClick={() => onGitFileClick?.(f.path)}
          className={`flex items-center gap-2 flex-1 min-w-0 px-3 py-1.5 text-left transition-colors ${consoleButtonFocusClass}`}
        >
          <span className={`w-4 text-center font-mono text-[11px] font-semibold ${colorCls} shrink-0`}>
            {label}
          </span>
          <span className="truncate text-[#202124] text-xs">{fileName}</span>
          {dirPath && (
            <span className="truncate text-[#9AA0A6] text-[10px]">{dirPath}</span>
          )}
          <span className="ml-auto text-[#9AA0A6] text-[10px] shrink-0">{desc}</span>
        </button>
        {stageAction && (
          <button
            onClick={() => stageAction(f.path)}
            title={stageAction === handleStageFile ? '暂存' : '取消暂存'}
            className={`shrink-0 p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#DADCE0] opacity-0 group-hover:opacity-100 transition-opacity ${consoleButtonFocusClass}`}
          >
            {stageAction === handleStageFile ? (
              <Plus className="h-3 w-3" />
            ) : (
              <Minus className="h-3 w-3" />
            )}
          </button>
        )}
      </div>
    );
  };

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
      // 源代码管理面板
      return (
        <div className="flex flex-col h-full min-h-0">
          {/* 标题 */}
          <div className="px-3 py-2 border-b border-[#E8EAED]">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">源代码管理</span>
              <div className="flex items-center gap-1">
                <button
                  title="刷新"
                  onClick={() => gitChanges?.fetchStatus()}
                  className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}
                >
                  <RefreshCw className="h-3 w-3" />
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
            {branch && (
              <div className="flex items-center gap-1.5 mt-1 text-[11px] text-zinc-500">
                <GitBranch className="h-3 w-3" />
                <span className="font-mono">{branch}</span>
                {gitChanges?.ahead > 0 && (
                  <span className="flex items-center gap-0.5 text-[#4A7C59]">
                    <ArrowUp className="h-2.5 w-2.5" />{gitChanges.ahead}
                  </span>
                )}
                {gitChanges?.behind > 0 && (
                  <span className="flex items-center gap-0.5 text-[#C06C5D]">
                    <ArrowDown className="h-2.5 w-2.5" />{gitChanges.behind}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 文件列表 */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {!gitHasChanges ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-zinc-400">
                <GitCommit className="h-6 w-6" />
                <p className="text-[10px]">暂无已保存的更改</p>
              </div>
            ) : (
              <div className="flex flex-col">
                {/* 暂存的更改 */}
                {gitStagedFiles.length > 0 && (
                  <>
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#E8EAED]">
                      <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                        暂存的更改 ({gitStagedFiles.length})
                      </span>
                      <button
                        onClick={handleUnstageAll}
                        title="全部取消暂存"
                        className={`text-[10px] text-zinc-400 hover:text-zinc-600 ${consoleButtonFocusClass}`}
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                    </div>
                    {gitStagedFiles.map((f) => renderGitFile(f, handleUnstageFile))}
                  </>
                )}
                {/* 未暂存的更改 */}
                {gitUnstagedFiles.length > 0 && (
                  <>
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#E8EAED]">
                      <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                        更改 ({gitUnstagedFiles.length})
                      </span>
                      <button
                        onClick={handleStageAll}
                        title="全部暂存"
                        className={`text-[10px] text-zinc-400 hover:text-zinc-600 ${consoleButtonFocusClass}`}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    {gitUnstagedFiles.map((f) => renderGitFile(f, handleStageFile))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* 提交区域：仅当有暂存文件时显示 */}
          {gitStagedFiles.length > 0 && (
            <div className="flex flex-col gap-1.5 px-3 py-2 border-t border-[#E8EAED]">
              <textarea
                placeholder="提交信息"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleCommit();
                  }
                }}
                rows={2}
                className="w-full text-xs px-2 py-1 rounded border border-[#DADCE0] bg-white resize-none focus:outline-none focus:border-[#5B8DB8]"
              />
              <div className="flex gap-1">
                <button
                  onClick={handleCommit}
                  disabled={!commitMessage.trim() || committing || gitChanges?.operation === 'commit'}
                  className={`flex-1 text-xs h-7 rounded ${buttonClass('primary', 'sm')}`}
                >
                  {committing || gitChanges?.operation === 'commit' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : '提交'}
                </button>
                <button
                  onClick={() => gitChanges?.push()}
                  disabled={!gitChanges?.ahead || gitChanges?.operation === 'push'}
                  className={`text-xs h-7 px-3 rounded ${buttonClass('secondary', 'sm')}`}
                >
                  {gitChanges?.operation === 'push' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : '推送'}
                </button>
              </div>
            </div>
          )}
        </div>
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
          <DiffViewer
            original={gitDiffView.original}
            modified={gitDiffView.modified}
            path={gitDiffView.path}
            loading={gitDiffView.loading}
            onClose={onCloseGitDiff}
          />
        ) : diffView ? (
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

      {showAuthorDialog && (
        <ConsoleDialogShell onClose={() => setShowAuthorDialog(false)}>
          <div className="p-4 w-80">
            <h3 className="font-bold text-lg text-zinc-900 mb-3">Git 提交信息</h3>
            <p className="text-xs text-zinc-500 mb-3">需要配置 git 用户名和邮箱才能提交</p>
            <div className="flex flex-col gap-2">
              <input
                ref={authorNameRef}
                type="text"
                placeholder="用户名"
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAuthorConfirm(); }}
                className={consoleInputClass}
              />
              <input
                type="email"
                placeholder="邮箱"
                value={authorEmail}
                onChange={(e) => setAuthorEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAuthorConfirm(); }}
                className={consoleInputClass}
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAuthorDialog(false)} className={buttonClass('secondary', 'sm')}>取消</button>
              <button onClick={handleAuthorConfirm} disabled={!authorName.trim() || !authorEmail.trim()} className={buttonClass('primary', 'sm')}>确认</button>
            </div>
          </div>
        </ConsoleDialogShell>
      )}

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
}