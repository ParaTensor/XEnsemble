import { useState } from 'react';
import { ArrowDown, ArrowUp, GitBranch, GitPullRequest, Loader2, Pencil, Upload, Download, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import CreatePRDialog from './CreatePRDialog';
import {
  ConsoleInlineDialog,
} from '../ConsoleDialog';
import Input from '../Input';
import Button from '../Button';
import {
  consoleIconButtonClass,
  consoleStructuredDialogHeaderClass,
  consoleStructuredDialogFooterClass,
  borderHairline,
  bgCanvas,
  textPrimary,
  textPlaceholder,
} from '../../lib/consoleTheme';

const GIT_PROVIDERS = new Set(['github', 'gitlab', 'gitea', 'local_git']);

export default function GitStatusBar({ projectId, project, git }) {
  const isGitProject = Boolean(projectId && project?.repoProvider && GIT_PROVIDERS.has(project.repoProvider));
  // Use the shared git state passed from the parent (merged useGitStatus)
  // instead of mounting a second useGitStatus instance (which would double
  // the 15s polling timer and DB/git load).
  const status = git ? {
    branch: git.branch,
    ahead: git.ahead,
    behind: git.behind,
    dirty: git.dirty,
    staged: git.staged,
    unstaged: git.unstaged,
    untracked: git.untracked,
  } : null;
  const operation = git?.operation;
  const commit = git?.commit;
  const push = git?.push;
  const pull = git?.pull;
  const fetchRemote = git?.fetchRemote;
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [createPROpen, setCreatePROpen] = useState(false);

  if (!isGitProject) return null;

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    setCommitting(true);
    try {
      await commit(commitMessage);
      setCommitMessage('');
      setShowCommitDialog(false);
    } finally {
      setCommitting(false);
    }
  };

  return (
    <>
      <div className={cn('flex h-10 shrink-0 items-center justify-between border-t border-[#E8EAED] bg-[#FAFBFC] px-4', borderHairline)}>
        <div className="flex min-w-0 items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 text-[#202124]">
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-[#9AA0A6]" />
            <span className="max-w-[12rem] truncate font-mono font-medium">
              {status?.branch || project?.currentBranch || 'unknown'}
            </span>
          </div>
          {(status?.ahead > 0 || status?.behind > 0) && (
            <div className="flex items-center gap-2 text-[#5F6368]">
              {status?.ahead > 0 && (
                <span className="flex items-center gap-0.5" title={`${status.ahead} commit(s) ahead`}>
                  <ArrowUp className="h-3 w-3" />
                  {status.ahead}
                </span>
              )}
              {status?.behind > 0 && (
                <span className="flex items-center gap-0.5" title={`${status.behind} commit(s) behind`}>
                  <ArrowDown className="h-3 w-3" />
                  {status.behind}
                </span>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 text-[#5F6368]">
            {status?.dirty ? (
              <>
                {status?.unstaged && <span>modified</span>}
                {status?.staged && <span>staged</span>}
                {status?.untracked && <span>untracked</span>}
              </>
            ) : (
              <span className="text-[#4A7C59]">clean</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowCommitDialog(true)}
            disabled={!status?.dirty || operation === 'commit'}
            title="Commit all changes"
            aria-label="Commit all changes"
            className={consoleIconButtonClass}
          >
            {operation === 'commit' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Pencil className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={push}
            disabled={!status?.ahead || operation === 'push'}
            title="Push branch"
            aria-label="Push branch"
            className={consoleIconButtonClass}
          >
            {operation === 'push' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={fetchRemote}
            disabled={operation === 'fetch'}
            title="Fetch from remote"
            aria-label="Fetch from remote"
            className={consoleIconButtonClass}
          >
            {operation === 'fetch' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={pull}
            disabled={operation === 'pull'}
            title="Pull latest changes"
            aria-label="Pull latest changes"
            className={consoleIconButtonClass}
          >
            {operation === 'pull' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
          </button>
          {project?.repoProvider !== 'local_git' && (
            <button
              type="button"
              onClick={() => setCreatePROpen(true)}
              disabled={!status?.branch}
              title={project?.repoProvider === 'gitlab' ? 'Create merge request' : 'Create pull request'}
              aria-label={project?.repoProvider === 'gitlab' ? 'Create merge request' : 'Create pull request'}
              className={consoleIconButtonClass}
            >
              <GitPullRequest className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {showCommitDialog && (
        <ConsoleInlineDialog
          onClose={() => setShowCommitDialog(false)}
          panelClassName={`${bgCanvas} border ${borderHairline} rounded-lg w-full max-w-sm shadow-sm`}
        >
          <div className={consoleStructuredDialogHeaderClass}>
            <h3 className={`font-semibold text-sm ${textPrimary}`}>Commit all changes</h3>
          </div>
          <div className="p-5 space-y-3">
            <label className={`block text-xs font-semibold uppercase tracking-wider ${textPlaceholder}`}>
              Commit message
            </label>
            <Input
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Describe your changes"
              autoFocus
            />
          </div>
          <div className={consoleStructuredDialogFooterClass}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowCommitDialog(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!commitMessage.trim() || committing}
              onClick={handleCommit}
            >
              {committing ? 'Committing…' : 'Commit'}
            </Button>
          </div>
        </ConsoleInlineDialog>
      )}

      <CreatePRDialog
        open={createPROpen}
        projectId={projectId}
        sourceBranch={status?.branch || project?.currentBranch}
        defaultTargetBranch={project?.repoDefaultBranch || 'main'}
        onClose={() => setCreatePROpen(false)}
      />
    </>
  );
}
