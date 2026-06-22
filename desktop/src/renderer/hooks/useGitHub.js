import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import * as githubApi from '../lib/githubApi.js';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 150; // 5 minutes

function isNotConnectedError(err) {
  return err?.message?.toLowerCase().includes('not connected');
}

export function useGitHub({ onChange } = {}) {
  const { showToast } = useToast();
  const [connection, setConnection] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchConnection = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await githubApi.getConnection();
      setConnection(data);
      onChange?.(data);
      return data;
    } catch (err) {
      if (!isNotConnectedError(err)) {
        if (!silent) setError(err.message);
      }
      setConnection(null);
      onChange?.(null);
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [onChange]);

  useEffect(() => {
    fetchConnection();
    return clearPoll;
  }, [fetchConnection, clearPoll]);

  const connect = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { auth_url: authUrl } = await githubApi.connectGitHub();
      githubApi.openExternal(authUrl);
      showToast('loading', 'Waiting for GitHub authorization…');
      clearPoll();

      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts += 1;
        const conn = await fetchConnection({ silent: true });
        if (conn) {
          clearPoll();
          showToast('success', `Connected to GitHub as ${conn.github_username || conn.githubUsername || 'GitHub'}`);
        } else if (attempts >= MAX_POLL_ATTEMPTS) {
          clearPoll();
          showToast('error', 'GitHub authorization timed out. Please try again.');
        }
      }, POLL_INTERVAL_MS);
      return true;
    } catch (err) {
      setError(err.message);
      showToast('error', err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchConnection, showToast, clearPoll]);

  const disconnect = useCallback(async () => {
    setLoading(true);
    try {
      await githubApi.disconnectGitHub();
      setConnection(null);
      onChange?.(null);
      showToast('success', 'Disconnected from GitHub.');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  }, [onChange, showToast]);

  return {
    connection,
    loading,
    error,
    fetchConnection,
    connect,
    disconnect,
  };
}
