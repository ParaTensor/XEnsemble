import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import * as githubApi from '../lib/githubApi';

const POLL_INTERVAL_MS = 15000;

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
    let timer;
    const scheduleNext = () => {
      timer = setTimeout(() => {
        // Skip polling when the tab is hidden (saves battery + server load).
        if (typeof document !== 'undefined' && document.hidden) {
          scheduleNext();
          return;
        }
        fetchStatus({ silent: true });
        scheduleNext();
      }, POLL_INTERVAL_MS);
    };
    scheduleNext();
    return () => clearTimeout(timer);
  }, [fetchStatus]);

  // Fetch immediately when tab becomes visible again.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisible = () => {
      if (!document.hidden && projectId) fetchStatus({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [projectId, fetchStatus]);

  const commit = useCallback(async (message, author) => {
    if (!projectId || !message?.trim()) return;
    setOperation('commit');
    try {
      const result = await githubApi.commitStaged(projectId, message.trim(), author);
      showToast('success', 'Changes committed.');
      fetchStatus({ silent: true });
      return result;
    } catch (err) {
      if (err.code === 'AUTHOR_REQUIRED') {
        throw err;
      }
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
      fetchStatus({ silent: true });
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
      fetchStatus({ silent: true });
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
