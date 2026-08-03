import { useCallback, useEffect, useState, useRef } from 'react';
import { useToast } from '../components/Toast';
import * as githubApi from '../lib/githubApi';

const POLL_INTERVAL_MS = 15000;
const FULL_POLL_INTERVAL_MS = 60000;

export function useGitStatus(projectId) {
  const { showToast } = useToast();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState(null);
  const lastFullAtRef = useRef(0);

  const fetchStatusFull = useCallback(async ({ silent = false } = {}) => {
    if (!projectId) return null;
    if (!silent) setLoading(true);
    try {
      const data = await githubApi.getGitStatus(projectId);
      setStatus(data);
      lastFullAtRef.current = Date.now();
      return data;
    } catch (err) {
      if (!silent) showToast('error', err.message);
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [projectId, showToast]);

  const fetchStatusLight = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await githubApi.getGitStatusLight(projectId);
      setStatus((prev) => prev ? { ...prev, ...data } : data);
    } catch {
      // ignore light poll errors silently
    }
  }, [projectId]);

  useEffect(() => {
    fetchStatusFull();
    lastFullAtRef.current = Date.now();
    let timer;
    const scheduleNext = () => {
      const now = Date.now();
      const needFull = (now - lastFullAtRef.current) >= FULL_POLL_INTERVAL_MS;
      const interval = needFull ? 0 : POLL_INTERVAL_MS;
      timer = setTimeout(() => {
        if (typeof document !== 'undefined' && document.hidden) {
          scheduleNext();
          return;
        }
        if (needFull || (Date.now() - lastFullAtRef.current) >= FULL_POLL_INTERVAL_MS) {
          fetchStatusFull({ silent: true });
          lastFullAtRef.current = Date.now();
        } else {
          fetchStatusLight();
        }
        scheduleNext();
      }, interval);
    };
    scheduleNext();
    return () => clearTimeout(timer);
  }, [fetchStatusFull, fetchStatusLight]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisible = () => {
      if (!document.hidden && projectId) {
        const now = Date.now();
        if ((now - lastFullAtRef.current) >= FULL_POLL_INTERVAL_MS) {
          fetchStatusFull({ silent: true });
          lastFullAtRef.current = now;
        } else {
          fetchStatusLight();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [projectId, fetchStatusFull, fetchStatusLight]);

  const commit = useCallback(async (message, author) => {
    if (!projectId || !message?.trim()) return;
    setOperation('commit');
    try {
      const result = await githubApi.commitStaged(projectId, message.trim(), author);
      showToast('success', 'Changes committed.');
      if (result.status && result.status.ahead != null) {
        setStatus((prev) => prev ? { ...prev, ...result.status } : null);
      } else {
        fetchStatusFull({ silent: true });
      }
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
  }, [projectId, showToast, fetchStatusFull]);

  const push = useCallback(async () => {
    if (!projectId) return;
    setOperation('push');
    try {
      const result = await githubApi.pushBranch(projectId, status?.branch);
      showToast('success', 'Branch pushed.');
      if (result.status) {
        setStatus(result.status);
      } else {
        fetchStatusFull({ silent: true });
      }
      return result;
    } catch (err) {
      showToast('error', err.message);
      throw err;
    } finally {
      setOperation(null);
    }
  }, [projectId, status?.branch, showToast, fetchStatusFull]);

  const pull = useCallback(async () => {
    if (!projectId) return;
    setOperation('pull');
    try {
      const result = await githubApi.pullLatest(projectId);
      showToast('success', 'Pulled latest changes.');
      fetchStatusFull({ silent: true });
      return result;
    } catch (err) {
      showToast('error', err.message);
      throw err;
    } finally {
      setOperation(null);
    }
  }, [projectId, showToast, fetchStatusFull]);

  return {
    status,
    loading,
    operation,
    commit,
    push,
    pull,
    fetchStatus: fetchStatusFull,
  };
}
