import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import * as githubApi from '../lib/githubApi';

const POLL_INTERVAL_MS = 2000;

export function useGitStatus(projectId) {
  const { showToast } = useToast();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState(null);

  const fetchStatus = useCallback(async ({ silent = false } = {}) => {
    if (!projectId) return null;
    if (!silent) setLoading(true);
    try {
      const data = await githubApi.getGitStatus(projectId);
      setStatus(data);
      return data;
    } catch (err) {
      if (!silent) showToast('error', err.message);
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [projectId, showToast]);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(() => fetchStatus({ silent: true }), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const commit = useCallback(async (message) => {
    if (!projectId || !message?.trim()) return;
    setOperation('commit');
    try {
      const result = await githubApi.commitAll(projectId, message.trim());
      showToast('success', 'Changes committed.');
      await fetchStatus({ silent: true });
      return result;
    } catch (err) {
      showToast('error', err.message);
      throw err;
    } finally {
      setOperation(null);
    }
  }, [projectId, showToast, fetchStatus]);

  const push = useCallback(async () => {
    if (!projectId) return;
    setOperation('push');
    try {
      const result = await githubApi.pushBranch(projectId, status?.branch);
      showToast('success', 'Branch pushed.');
      await fetchStatus({ silent: true });
      return result;
    } catch (err) {
      showToast('error', err.message);
      throw err;
    } finally {
      setOperation(null);
    }
  }, [projectId, status?.branch, showToast, fetchStatus]);

  const pull = useCallback(async () => {
    if (!projectId) return;
    setOperation('pull');
    try {
      const result = await githubApi.pullLatest(projectId);
      showToast('success', 'Pulled latest changes.');
      await fetchStatus({ silent: true });
      return result;
    } catch (err) {
      showToast('error', err.message);
      throw err;
    } finally {
      setOperation(null);
    }
  }, [projectId, showToast, fetchStatus]);

  return {
    status,
    loading,
    operation,
    commit,
    push,
    pull,
    fetchStatus,
  };
}
