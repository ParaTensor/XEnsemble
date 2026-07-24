import { useState, useCallback, useRef, useEffect } from 'react';
import {
  GitBranch, GitCommit, Clock, Eye, GitPullRequest, MessageSquare,
  AlertTriangle, RefreshCw, PanelLeftClose, ArrowUp, ArrowDown,
  Plus, Minus, Loader2,
} from 'lucide-react';
import { consoleButtonFocusClass } from '../lib/consoleTheme';
import { buttonClass } from '../lib/buttonStyles';
import {
  GitHistoryPanel,
  GitBlamePanel,
  MergeRequestListPanel,
  CodeReviewPanel,
  ConflictResolutionPanel,
} from './git';

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

const GIT_SUB_TABS = [
  { key: 'changes', label: 'Diff', icon: GitBranch },
  { key: 'history', label: 'History', icon: Clock },
  { key: 'blame', label: 'Blame', icon: Eye },
  { key: 'prs', label: 'Pull Request', icon: GitPullRequest },
  { key: 'review', label: 'Code Review', icon: MessageSquare },
  { key: 'conflicts', label: 'Conflicts', icon: AlertTriangle },
];

export default function SourceControlPanel({ projectId, gitChanges, onGitFileClick, onCollapse, provider, sessionLive }) {
  const [gitSubTab, setGitSubTab] = useState(() => {
    const stored = sessionStorage.getItem('xe_git_subtab');
    return stored || 'changes';
  });
  const [selectedMergeRequestId, setSelectedMergeRequestId] = useState(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [showAuthorDialog, setShowAuthorDialog] = useState(false);
  const [authorName, setAuthorName] = useState(() => localStorage.getItem('xe_git_author_name') || '');
  const [authorEmail, setAuthorEmail] = useState(() => localStorage.getItem('xe_git_author_email') || '');
  const authorNameRef = useRef(null);

  useEffect(() => {
    sessionStorage.setItem('xe_git_subtab', gitSubTab);
  }, [gitSubTab]);

  useEffect(() => {
    if (showAuthorDialog && authorNameRef.current) {
      authorNameRef.current.focus();
    }
  }, [showAuthorDialog]);

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

  const handleSelectMR = useCallback((mr) => {
    setSelectedMergeRequestId(mr.id);
    setGitSubTab('review');
  }, []);

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

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Sub-tab bar */}
      <div className="flex items-center justify-between border-b border-[#E8EAED] px-1 shrink-0">
        <div className="flex overflow-x-auto">
          {GIT_SUB_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = gitSubTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setGitSubTab(tab.key)}
                className={`flex items-center gap-1 px-2.5 py-2 text-[11px] font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                  isActive
                    ? 'border-[#202124] text-[#202124]'
                    : 'border-transparent text-[#5F6368] hover:text-[#202124]'
                } ${consoleButtonFocusClass}`}
              >
                <Icon className="h-3 w-3" />
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-0.5 pr-1 shrink-0">
          <button
            title="刷新"
            onClick={() => gitChanges?.fetchStatus()}
            className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          <button
            title="收起侧栏"
            onClick={onCollapse}
            className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Branch info - shown for all sub-tabs */}
      {branch && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[#E8EAED] text-[11px] text-zinc-500 shrink-0">
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

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {gitSubTab === 'changes' && (
          <div className="flex flex-col h-full min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto">
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

            {gitStagedFiles.length > 0 && (
              <div className="flex flex-col gap-1.5 px-3 py-2 border-t border-[#E8EAED] shrink-0">
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
                  {gitChanges?.ahead > 0 && (
                    <button
                      onClick={() => gitChanges?.push()}
                      disabled={gitChanges?.operation === 'push'}
                      className={`text-xs h-7 px-3 rounded ${buttonClass('secondary', 'sm')}`}
                    >
                      {gitChanges?.operation === 'push' ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : '推送'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {gitStagedFiles.length === 0 && gitChanges?.ahead > 0 && (
              <div className="flex flex-col gap-1.5 px-3 py-2 border-t border-[#E8EAED] shrink-0">
                <button
                  onClick={() => gitChanges?.push()}
                  disabled={gitChanges?.operation === 'push'}
                  className={`text-xs h-7 rounded ${buttonClass('primary', 'sm')}`}
                >
                  {gitChanges?.operation === 'push' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : '推送'}
                </button>
              </div>
            )}
          </div>
        )}

        {gitSubTab === 'history' && (
          sessionLive ? (
            <GitHistoryPanel projectId={projectId} />
          ) : (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-zinc-400">
              <Clock className="h-6 w-6" />
              <p className="text-[10px]">启动 session 后可查看提交历史</p>
            </div>
          )
        )}

        {gitSubTab === 'blame' && (
          sessionLive ? (
            <GitBlamePanel projectId={projectId} />
          ) : (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-zinc-400">
              <Eye className="h-6 w-6" />
              <p className="text-[10px]">启动 session 后可查看 Blame</p>
            </div>
          )
        )}

        {gitSubTab === 'prs' && (
          <MergeRequestListPanel
            projectId={projectId}
            provider={provider}
            onSelectMR={handleSelectMR}
          />
        )}

        {gitSubTab === 'review' && (
          <CodeReviewPanel
            projectId={projectId}
            mergeRequestId={selectedMergeRequestId}
          />
        )}

        {gitSubTab === 'conflicts' && (
          sessionLive ? (
            <ConflictResolutionPanel projectId={projectId} />
          ) : (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-zinc-400">
              <AlertTriangle className="h-6 w-6" />
              <p className="text-[10px]">启动 session 后可查看冲突</p>
            </div>
          )
        )}
      </div>

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