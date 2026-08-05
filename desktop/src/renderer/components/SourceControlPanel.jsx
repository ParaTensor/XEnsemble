import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  GitBranch, GitCommit, GitPullRequest, RefreshCw, PanelLeftClose, ArrowUp, ArrowDown,
  Plus, Minus, Loader2, ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown, FileText,
  Upload, Download,
} from 'lucide-react';
import {
  consoleButtonFocusClass,
  consoleDropdownPanelClass,
  consoleMenuDropdownZClass,
} from '@/lib/consoleTheme';
import { buttonClass } from '@/lib/buttonStyles';
import CreatePRDialog from './github/CreatePRDialog';
import { getGitFileDiff } from '@/lib/githubApi';
import { useToast } from './Toast';

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
  '??': '新增',
  'R ': '重命名',
};

export default function SourceControlPanel({ projectId, gitChanges, onJumpToFile, onCollapse, provider, sessionLive }) {
  const { showToast } = useToast();
  const [commitMessage, setCommitMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [showAuthorDialog, setShowAuthorDialog] = useState(false);
  const [createPROpen, setCreatePROpen] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [actionMenuRect, setActionMenuRect] = useState(null);
  const [authorName, setAuthorName] = useState(() => localStorage.getItem('xe_git_author_name') || '');
  const [authorEmail, setAuthorEmail] = useState(() => localStorage.getItem('xe_git_author_email') || '');
  const [expandedFiles, setExpandedFiles] = useState(new Set());
  const [fileDiffs, setFileDiffs] = useState({});
  const [loadingDiff, setLoadingDiff] = useState(null);
  const [showFileList, setShowFileList] = useState(false);
  const authorNameRef = useRef(null);
  const actionMenuBtnRef = useRef(null);

  useEffect(() => {
    if (showAuthorDialog && authorNameRef.current) {
      authorNameRef.current.focus();
    }
  }, [showAuthorDialog]);

  useEffect(() => {
    if (!actionMenuOpen) {
      setActionMenuRect(null);
      return undefined;
    }
    const update = () => {
      const el = actionMenuBtnRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const menuWidth = 180;
      const menuEstHeight = 160;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openAbove = spaceBelow < menuEstHeight + 8 && rect.top > menuEstHeight + 8;
      setActionMenuRect({
        top: openAbove ? null : rect.bottom + 4,
        bottom: openAbove ? window.innerHeight - rect.top + 4 : null,
        left: Math.max(8, rect.right - menuWidth),
        width: menuWidth,
      });
    };
    update();
    const onDoc = (e) => {
      if (actionMenuBtnRef.current?.contains(e.target)) return;
      const menu = document.getElementById('changes-action-menu');
      if (menu?.contains(e.target)) return;
      setActionMenuOpen(false);
    };
    window.addEventListener('resize', update);
    document.addEventListener('mousedown', onDoc);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [actionMenuOpen]);

  const gitStagedFiles = gitChanges?.stagedFiles || [];
  const gitUnstagedFiles = gitChanges?.unstagedFiles || [];
  const gitHasChanges = gitStagedFiles.length + gitUnstagedFiles.length > 0;
  const changeCount = gitStagedFiles.length + gitUnstagedFiles.length;
  const branch = gitChanges?.branch || '';
  const isLocalGit = !provider || provider === 'none' || provider === 'local_git';

  const handleStageAll = useCallback(async () => {
    const paths = gitUnstagedFiles.map((f) => f.path);
    if (paths.length === 0) return;
    setFileDiffs({});
    await gitChanges?.stage(paths);
  }, [gitUnstagedFiles, gitChanges]);

  const handleUnstageAll = useCallback(async () => {
    const paths = gitStagedFiles.map((f) => f.path);
    if (paths.length === 0) return;
    setFileDiffs({});
    await gitChanges?.unstage(paths);
  }, [gitStagedFiles, gitChanges]);

  const handleStageFile = useCallback(async (path) => {
    setFileDiffs((prev) => { const next = { ...prev }; delete next[path]; return next; });
    await gitChanges?.stage([path]);
    if (expandedFiles.has(path)) {
      try {
        const data = await getGitFileDiff(projectId, path);
        const diff = data && typeof data === 'object' && !Array.isArray(data)
          ? (typeof data.diff === 'string' ? data.diff : '') : (typeof data === 'string' ? data : '');
        setFileDiffs((prev) => ({ ...prev, [path]: { diff, binary: false, truncated: false } }));
      } catch (_) {}
    }
  }, [gitChanges, expandedFiles, projectId]);

  const handleUnstageFile = useCallback(async (path) => {
    setFileDiffs((prev) => { const next = { ...prev }; delete next[path]; return next; });
    await gitChanges?.unstage([path]);
    if (expandedFiles.has(path)) {
      try {
        const data = await getGitFileDiff(projectId, path);
        const diff = data && typeof data === 'object' && !Array.isArray(data)
          ? (typeof data.diff === 'string' ? data.diff : '') : (typeof data === 'string' ? data : '');
        setFileDiffs((prev) => ({ ...prev, [path]: { diff, binary: false, truncated: false } }));
      } catch (_) {}
    }
  }, [gitChanges, expandedFiles, projectId]);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) return;
    setCommitting(true);
    try {
      // Auto-stage all unstaged files when nothing is staged yet (VS Code-like UX)
      if (gitStagedFiles.length === 0 && gitUnstagedFiles.length > 0) {
        const paths = gitUnstagedFiles.map((f) => f.path).filter(Boolean);
        if (paths.length > 0) {
          await gitChanges?.stage(paths);
        }
      }
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
  }, [commitMessage, gitChanges, authorName, authorEmail, gitStagedFiles, gitUnstagedFiles]);

  const handlePull = useCallback(async () => {
    setActionMenuOpen(false);
    setPulling(true);
    try {
      await gitChanges?.pull();
      showToast('success', 'Pulled latest changes.');
    } catch (err) {
      showToast('error', err.message || 'Pull failed');
    } finally {
      setPulling(false);
    }
  }, [gitChanges, showToast]);

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

  const handlePush = useCallback(async () => {
    setActionMenuOpen(false);
    setPushing(true);
    try {
      await gitChanges?.push();
      showToast('success', 'Pushed');
    } catch (err) {
      showToast('error', err.message || 'Push failed');
    } finally {
      setPushing(false);
    }
  }, [gitChanges, showToast]);

  const handleOpenCreatePR = useCallback(() => {
    setActionMenuOpen(false);
    setCreatePROpen(true);
  }, []);

  const normalizeDiffEntry = useCallback((data, fallbackText = '') => {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return {
        diff: typeof data.diff === 'string' ? data.diff : fallbackText,
        binary: Boolean(data.binary),
        truncated: Boolean(data.truncated),
      };
    }
    return {
      diff: typeof data === 'string' ? data : fallbackText,
      binary: false,
      truncated: false,
    };
  }, []);

  const renderDiffLines = useCallback((raw) => {
    if (!raw) return <span className="text-zinc-400">No changes</span>;
    const lines = raw.split('\n');
    return lines.map((line, i) => {
      if (line.startsWith('---') || line.startsWith('+++')) {
        return null;
      }
      if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted ')) {
        return null;
      }
      if (line.startsWith('\\ No newline')) {
        return null;
      }
      const first = line[0];
      if (first === '@') {
        return null;
      }
      if (first === '+') {
        return <div key={i} className="bg-[#DFF7E4] text-[#1A7F37] pl-2">{line.slice(1)}</div>;
      }
      if (first === '-') {
        return <div key={i} className="bg-[#FFEBE9] text-[#CF222E] pl-2">{line.slice(1)}</div>;
      }
      return <div key={i} className="bg-white text-[#1F2328] pl-2">{line || ' '}</div>;
    });
  }, []);

  const toggleFileExpand = useCallback(async (filePath) => {
    const newExpanded = new Set(expandedFiles);
    if (newExpanded.has(filePath)) {
      newExpanded.delete(filePath);
      setExpandedFiles(newExpanded);
    } else {
      newExpanded.add(filePath);
      setExpandedFiles(newExpanded);
      if (!fileDiffs[filePath]) {
        setLoadingDiff(filePath);
        try {
          const data = await getGitFileDiff(projectId, filePath);
          setFileDiffs((prev) => ({ ...prev, [filePath]: normalizeDiffEntry(data) }));
        } catch (_) {
          setFileDiffs((prev) => ({
            ...prev,
            [filePath]: normalizeDiffEntry({ diff: 'Failed to load diff' }),
          }));
        } finally {
          setLoadingDiff(null);
        }
      }
    }
  }, [expandedFiles, fileDiffs, projectId, normalizeDiffEntry]);

  const allFiles = [...gitStagedFiles, ...gitUnstagedFiles];
  const allExpanded = allFiles.length > 0 && allFiles.every((f) => expandedFiles.has(f.path));

  const toggleExpandAll = useCallback(async () => {
    if (allExpanded) {
      setExpandedFiles(new Set());
      return;
    }
    const newExpanded = new Set(allFiles.map((f) => f.path));
    setExpandedFiles(newExpanded);
    const toFetch = allFiles.filter((f) => !fileDiffs[f.path]).map((f) => f.path);
    if (toFetch.length === 0) return;
    setLoadingDiff('batch');
    try {
      const results = await Promise.all(
        toFetch.map((p) => getGitFileDiff(projectId, p)
          .then((d) => [p, normalizeDiffEntry(d)])
          .catch(() => [p, normalizeDiffEntry({ diff: 'Failed to load diff' })])),
      );
      setFileDiffs((prev) => {
        const next = { ...prev };
        for (const [p, d] of results) next[p] = d;
        return next;
      });
    } finally {
      setLoadingDiff(null);
    }
  }, [allExpanded, allFiles, fileDiffs, projectId, normalizeDiffEntry]);

  const renderGitFile = (f, stageAction) => {
    const label = GIT_STATUS_LABELS[f.status] || f.status;
    const colorCls = GIT_STATUS_COLORS[f.status] || 'text-zinc-400';
    const desc = GIT_STATUS_DESC[f.status] || '';
    const fileName = f.path.split('/').pop();
    const dirPath = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    const isExpanded = expandedFiles.has(f.path);
    const diffEntry = fileDiffs[f.path];
    const diffText = typeof diffEntry === 'string' ? diffEntry : diffEntry?.diff;
    const diffBinary = Boolean(diffEntry && typeof diffEntry === 'object' && diffEntry.binary);
    const diffTruncated = Boolean(diffEntry && typeof diffEntry === 'object' && diffEntry.truncated);
    const isLoading = loadingDiff === f.path;

    return (
      <div key={f.path}>
        <div className="flex items-center group hover:bg-[#E8EAED]">
          <button
            onClick={() => toggleFileExpand(f.path)}
            className="shrink-0 p-0.5 text-zinc-400 hover:text-zinc-600"
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <button
            onClick={() => toggleFileExpand(f.path)}
            className={`flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 text-left transition-colors ${consoleButtonFocusClass}`}
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
        {isExpanded && (
          <div className="border-t border-[#E8EAED] bg-[#FAFAFA]">
            {isLoading ? (
              <div className="flex items-center justify-center py-4 text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : diffEntry != null ? (
              diffBinary ? (
                <div className="px-3 py-3 text-[11px] text-zinc-500" data-testid="inline-diff-binary">
                  二进制文件，无法显示文本对比
                </div>
              ) : (
                <div className="text-[11px] leading-relaxed overflow-x-auto font-mono select-text"
                     style={{ tabSize: 4, MozTabSize: 4 }}>
                  {renderDiffLines(diffText)}
                  {diffTruncated && (
                    <div className="px-2 py-1 text-amber-700 bg-amber-50 border-t border-amber-200" data-testid="inline-diff-truncated">
                      内容过大，已截断显示
                    </div>
                  )}
                </div>
              )
            ) : null}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0 w-full">
      <div className="flex items-center justify-between gap-2 border-b border-[#E8EAED] px-3 py-1.5 shrink-0">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500">
          <GitBranch className="h-3 w-3 shrink-0" />
          <span className="font-mono truncate">{branch || '—'}</span>
          {gitChanges?.ahead > 0 && (
            <span className="flex items-center gap-0.5 text-[#4A7C59] shrink-0">
              <ArrowUp className="h-2.5 w-2.5" />{gitChanges.ahead}
            </span>
          )}
          {gitChanges?.behind > 0 && (
            <span className="flex items-center gap-0.5 text-[#C06C5D] shrink-0">
              <ArrowDown className="h-2.5 w-2.5" />{gitChanges.behind}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {gitHasChanges && (
            <button
              title={allExpanded ? '全部折叠' : '全部展开'}
              onClick={toggleExpandAll}
              className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}
            >
              {allExpanded ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
            </button>
          )}
          {gitHasChanges && (
            <button
              title="文件列表"
              onClick={() => setShowFileList((v) => !v)}
              className={`p-1 rounded ${showFileList ? 'text-[#202124] bg-[#E8EAED]' : 'text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED]'} ${consoleButtonFocusClass}`}
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            title="刷新"
            onClick={() => gitChanges?.fetchStatus()}
            className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          {onCollapse && (
            <button
              title="收起侧栏"
              onClick={onCollapse}
              className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        <div className="flex flex-col h-full min-h-0 relative">
          {showFileList && (
            <div className="absolute right-2 top-1 z-20 w-56 max-h-64 overflow-y-auto console-scroll-hidden bg-white border border-[#E8EAED] rounded-lg shadow-lg">
              <div className="px-3 py-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-[#E8EAED] sticky top-0 bg-white">
                Files ({gitStagedFiles.length + gitUnstagedFiles.length})
              </div>
              <div className="py-1">
                {gitStagedFiles.length > 0 && (
                  <div className="text-[9px] text-zinc-400 px-3 py-0.5">暂存的更改</div>
                )}
                {gitStagedFiles.map((f) => {
                  const name = f.path.split('/').pop();
                  const label = GIT_STATUS_LABELS[f.status] || f.status;
                  return (
                    <button
                      key={'list-' + f.path}
                      onClick={() => { toggleFileExpand(f.path); setShowFileList(false); onJumpToFile?.(f.path); }}
                      className={`w-full text-left px-3 py-1 text-xs truncate hover:bg-[#F4F5F6] ${consoleButtonFocusClass}`}
                    >
                      <span className={`font-mono text-[9px] mr-1.5 ${GIT_STATUS_COLORS[f.status] || 'text-zinc-400'}`}>
                        {label}
                      </span>
                      {name}
                    </button>
                  );
                })}
                {gitUnstagedFiles.length > 0 && (
                  <div className="text-[9px] text-zinc-400 px-3 py-0.5 mt-0.5">更改</div>
                )}
                {gitUnstagedFiles.map((f) => {
                  const name = f.path.split('/').pop();
                  const label = GIT_STATUS_LABELS[f.status] || f.status;
                  return (
                    <button
                      key={'list-' + f.path}
                      onClick={() => { toggleFileExpand(f.path); setShowFileList(false); onJumpToFile?.(f.path); }}
                      className={`w-full text-left px-3 py-1 text-xs truncate hover:bg-[#F4F5F6] ${consoleButtonFocusClass}`}
                    >
                      <span className={`font-mono text-[9px] mr-1.5 ${GIT_STATUS_COLORS[f.status] || 'text-zinc-400'}`}>
                        {label}
                      </span>
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto console-scroll-hidden">
            {!gitHasChanges ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-zinc-400">
                <GitCommit className="h-6 w-6" />
                <p className="text-[10px]">暂无已保存的更改</p>
              </div>
            ) : (
              <div className="flex flex-col">
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

          <div className="flex flex-col gap-1.5 px-3 py-2 border-t border-[#E8EAED] shrink-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-[#5F6368]">
                {changeCount > 0 ? `${changeCount} change${changeCount === 1 ? '' : 's'}` : 'No changes'}
                {gitChanges?.ahead > 0 ? ` · ↑${gitChanges.ahead}` : ''}
              </span>
              <div className="flex items-stretch shrink-0">
                <button
                  type="button"
                  onClick={handleCommit}
                  disabled={!commitMessage.trim() || (gitStagedFiles.length === 0 && gitUnstagedFiles.length === 0) || committing || gitChanges?.operation === 'commit'}
                  className={`${buttonClass('primary', 'sm')} h-7 rounded-r-none px-3 text-xs ${consoleButtonFocusClass}`}
                >
                  {committing || gitChanges?.operation === 'commit' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : gitStagedFiles.length === 0 && gitUnstagedFiles.length > 0 ? 'Stage All & Commit' : 'Commit'}
                </button>
                <button
                  ref={actionMenuBtnRef}
                  type="button"
                  title="More actions"
                  onClick={() => setActionMenuOpen((v) => !v)}
                  className={`${buttonClass('primary', 'sm')} h-7 rounded-l-none border-l border-white/20 px-1.5 ${consoleButtonFocusClass}`}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {gitStagedFiles.length + gitUnstagedFiles.length > 0 && (
              <textarea
                placeholder="Commit message"
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
            )}
          </div>
        </div>
      </div>

      {actionMenuOpen && actionMenuRect && createPortal(
        <div
          id="changes-action-menu"
          className={`fixed ${consoleMenuDropdownZClass} ${consoleDropdownPanelClass} py-1 shadow-lg`}
          style={{ top: actionMenuRect.top, bottom: actionMenuRect.bottom, left: actionMenuRect.left, width: actionMenuRect.width }}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            disabled={!commitMessage.trim() || (gitStagedFiles.length === 0 && gitUnstagedFiles.length === 0) || committing}
            onClick={() => { setActionMenuOpen(false); handleCommit(); }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 ${consoleButtonFocusClass}`}
          >
            <GitCommit className="h-3.5 w-3.5" />
            {gitStagedFiles.length === 0 && gitUnstagedFiles.length > 0 ? 'Stage All & Commit' : 'Commit'}
          </button>
          {gitChanges?.behind > 0 && (
            <button
              type="button"
              role="menuitem"
              disabled={pulling || gitChanges?.operation === 'pull'}
              onClick={handlePull}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 ${consoleButtonFocusClass}`}
            >
              {pulling || gitChanges?.operation === 'pull' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Pull ({gitChanges.behind})
            </button>
          )}
          {!isLocalGit && (
            <button
              type="button"
              role="menuitem"
              disabled={pushing || gitChanges?.operation === 'push'}
              onClick={handlePush}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 ${consoleButtonFocusClass}`}
            >
              {pushing || gitChanges?.operation === 'push' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              Push{gitChanges?.ahead > 0 ? ` (${gitChanges.ahead})` : ''}
            </button>
          )}
          {!isLocalGit && (
            <button
              type="button"
              role="menuitem"
              disabled={!branch}
              onClick={handleOpenCreatePR}
              title="将自动 Push 并创建 Pull Request"
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 ${consoleButtonFocusClass}`}
            >
              <GitPullRequest className="h-3.5 w-3.5" />
              Create PR
            </button>
          )}
        </div>,
        document.body,
      )}

      <CreatePRDialog
        open={createPROpen}
        projectId={projectId}
        sourceBranch={branch}
        defaultTargetBranch="main"
        onClose={() => setCreatePROpen(false)}
      />

      {/* Author dialog */}
      {showAuthorDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-xl p-6 w-80">
            <h3 className="text-sm font-semibold text-[#202124] mb-4">设置 Git 作者信息</h3>
            <div className="flex flex-col gap-3">
              <input
                ref={authorNameRef}
                type="text"
                placeholder="姓名"
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                className="w-full text-xs px-2 py-1.5 rounded border border-[#DADCE0] bg-white focus:outline-none focus:border-[#5B8DB8]"
              />
              <input
                type="email"
                placeholder="邮箱"
                value={authorEmail}
                onChange={(e) => setAuthorEmail(e.target.value)}
                className="w-full text-xs px-2 py-1.5 rounded border border-[#DADCE0] bg-white focus:outline-none focus:border-[#5B8DB8]"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowAuthorDialog(false)}
                  className={`text-xs h-7 px-3 rounded ${buttonClass('secondary', 'sm')}`}
                >
                  取消
                </button>
                <button
                  onClick={handleAuthorConfirm}
                  disabled={!authorName.trim() || !authorEmail.trim()}
                  className={`text-xs h-7 px-3 rounded ${buttonClass('primary', 'sm')}`}
                >
                  确认
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}