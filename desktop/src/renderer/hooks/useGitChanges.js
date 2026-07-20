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

  return {
    branch: status?.branch,
    sha: status?.sha,
    dirty: status?.dirty,
    files: status?.files || [],
    ahead: status?.ahead || 0,
    behind: status?.behind || 0,
    loading,
    operation,
    commit,
    push,
    pull,
    fetchStatus,
    getFileDiff,
  };
}