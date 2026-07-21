import { useCallback } from 'react';
import { useGitStatus } from './useGitStatus';
import * as githubApi from '../lib/githubApi';

export function useGitChanges(projectId) {
  const { status, loading, operation, commit, push, pull, fetchStatus } = useGitStatus(projectId);

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

  const stage = useCallback(async (files) => {
    if (!projectId || !files?.length) return;
    await githubApi.stageFiles(projectId, files);
    await fetchStatus({ silent: true });
  }, [projectId, fetchStatus]);

  const unstage = useCallback(async (files) => {
    if (!projectId || !files?.length) return;
    await githubApi.unstageFiles(projectId, files);
    await fetchStatus({ silent: true });
  }, [projectId, fetchStatus]);

  return {
    branch: status?.branch,
    sha: status?.sha,
    dirty: status?.dirty,
    staged: status?.staged,
    files: status?.files || [],
    stagedFiles: status?.stagedFiles || [],
    unstagedFiles: status?.unstagedFiles || [],
    ahead: status?.ahead || 0,
    behind: status?.behind || 0,
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