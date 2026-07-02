import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import * as gitApi from '../lib/gitApi';
import { openExternal } from '../lib/githubApi';
import { isOAuthNotConfiguredError } from '../lib/gitLabels';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 150;

function isNotConnectedError(err) {
  return err?.message?.toLowerCase().includes('not connected');
}

export function useGitProvider(providerName, { onChange } = {}) {
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
    if (!providerName) return null;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await gitApi.getConnection(providerName);
      setConnection(data);
      onChange?.(data);
      return data;
    } catch (err) {
      if (!isNotConnectedError(err) && !silent) setError(err.message);
      setConnection(null);
      onChange?.(null);
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [providerName, onChange]);

  useEffect(() => {
    if (providerName) fetchConnection();
    return clearPoll;
  }, [providerName, fetchConnection, clearPoll]);

  const connect = useCallback(async () => {
    if (!providerName) return false;
    setLoading(true);
    setError(null);
    try {
      const { auth_url: authUrl } = await gitApi.connectProvider(providerName);
      openExternal(authUrl);
      showToast('loading', `Waiting for ${providerName} authorization…`);
      clearPoll();

      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts += 1;
        const conn = await fetchConnection({ silent: true });
        if (conn) {
          clearPoll();
          const username = conn.remote_username || conn.remoteUsername
            || conn.github_username || conn.githubUsername || providerName;
          showToast('success', `Connected to ${providerName} as ${username}`);
        } else if (attempts >= MAX_POLL_ATTEMPTS) {
          clearPoll();
          showToast('error', `${providerName} authorization timed out. Please try again.`);
        }
      }, POLL_INTERVAL_MS);
      return true;
    } catch (err) {
      setError(err.message);
      if (!isOAuthNotConfiguredError(err.message)) {
        showToast('error', err.message);
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, [providerName, fetchConnection, showToast, clearPoll]);

  const disconnect = useCallback(async () => {
    if (!providerName) return;
    setLoading(true);
    try {
      await gitApi.disconnectProvider(providerName);
      setConnection(null);
      onChange?.(null);
      showToast('success', `Disconnected from ${providerName}.`);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  }, [providerName, onChange, showToast]);

  return {
    connection,
    loading,
    error,
    fetchConnection,
    connect,
    disconnect,
  };
}
