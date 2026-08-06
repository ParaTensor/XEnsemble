import { useState, useCallback, useEffect } from 'react';
import { useGitStatus } from './useGitStatus';
import * as githubApi from '../lib/githubApi';

export function useGitChanges(projectId, fullPollEnabledRef) {
  const { status, loading, operation, commit: originalCommit, push: originalPush, pull: originalPull, fetchStatus } = useGitStatus(projectId, fullPollEnabledRef);
  const [optimistic, setOptimistic] = useState(null);

  useEffect(() => {
    if (optimistic && status) {
      const stagedMatch = arraysEqual(
        (optimistic.stagedFiles || []).map((f) => f.path).sort(),
        (status.stagedFiles || []).map((f) => f.path).sort(),
      );
      const unstagedMatch = arraysEqual(
        (optimistic.unstagedFiles || []).map((f) => f.path).sort(),
        (status.unstagedFiles || []).map((f) => f.path).sort(),
      );
      if (stagedMatch && unstagedMatch) {
        setOptimistic(null);
      }
    }
  }, [status, optimistic]);

  const merged = optimistic || status;

  const getFileDiff = useCallback(async (filePath) => {
    if (!projectId) return '';
    try {
      const data = await githubApi.getGitFileDiff(projectId, filePath);
      return data.diff || '';
    } catch {
      return '';
    }
  }, [projectId]);

  const getHeadContent = useCallback(async (filePath) => {
    if (!projectId) return '';
    try {
      const data = await githubApi.getGitFileContent(projectId, filePath, 'HEAD');
      return data.content || '';
    } catch {
      return '';
    }
  }, [projectId]);

  const commit = useCallback(async (message, author) => {
    const result = await originalCommit(message, author);
    setOptimistic(null);
    await fetchStatus({ silent: true });
    return result;
  }, [originalCommit, fetchStatus]);

  const push = useCallback(async () => {
    const result = await originalPush();
    setOptimistic(null);
    return result;
  }, [originalPush]);

  const pull = useCallback(async () => {
    const result = await originalPull();
    setOptimistic(null);
    return result;
  }, [originalPull]);

  const stage = useCallback(async (files) => {
    if (!projectId || !files?.length) return;
    const fileSet = new Set(files);
    setOptimistic((prev) => {
      const base = prev || status;
      if (!base) return null;
      const moved = (base.unstagedFiles || []).filter((f) => fileSet.has(f.path));
      return {
        ...base,
        stagedFiles: [...(base.stagedFiles || []), ...moved],
        unstagedFiles: (base.unstagedFiles || []).filter((f) => !fileSet.has(f.path)),
        staged: (base.stagedFiles || []).length + moved.length > 0,
      };
    });
    await githubApi.stageFiles(projectId, files);
    fetchStatus({ silent: true });
  }, [projectId, fetchStatus, status]);

  const unstage = useCallback(async (files) => {
    if (!projectId || !files?.length) return;
    const fileSet = new Set(files);
    setOptimistic((prev) => {
      const base = prev || status;
      if (!base) return null;
      const moved = (base.stagedFiles || []).filter((f) => fileSet.has(f.path));
      return {
        ...base,
        unstagedFiles: [...(base.unstagedFiles || []), ...moved],
        stagedFiles: (base.stagedFiles || []).filter((f) => !fileSet.has(f.path)),
        staged: (base.stagedFiles || []).length - moved.length > 0,
      };
    });
    await githubApi.unstageFiles(projectId, files);
    fetchStatus({ silent: true });
  }, [projectId, fetchStatus, status]);

  return {
    branch: merged?.branch,
    sha: merged?.sha,
    dirty: merged?.dirty,
    staged: merged?.staged,
    unstaged: merged?.unstaged,
    untracked: merged?.untracked,
    files: merged?.files || [],
    stagedFiles: merged?.stagedFiles || [],
    unstagedFiles: merged?.unstagedFiles || [],
    ahead: merged?.ahead || 0,
    behind: merged?.behind || 0,
    loading,
    operation,
    commit,
    push,
    pull,
    fetchStatus,
    getFileDiff,
    getHeadContent,
    stage,
    unstage,
  };
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}