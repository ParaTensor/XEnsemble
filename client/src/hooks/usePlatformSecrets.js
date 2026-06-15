import { useState, useEffect, useCallback, useContext } from 'react';
import { AuthContext } from '../App';
import { useToast } from '../components/Toast';

import { getApiBase, apiFetch } from '../lib/api';

export function usePlatformSecrets() {
  const { token } = useContext(AuthContext);
  const { showToast } = useToast();
  const [hints, setHints] = useState({});
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return fetch(`${getApiBase()}/api/v1/admin/agent-secrets`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data === 'object' && !data.error) {
          setHints(data);
        }
      })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const saveSecrets = async (payload, { successMessage = 'Platform settings saved.' } = {}) => {
    setSaving(true);
    try {
      const res = await fetch(`${getApiBase()}/api/v1/admin/agent-secrets`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save.');
      if (data.secrets) setHints(data.secrets);
      else await load();
      showToast('success', successMessage);
      return true;
    } catch (err) {
      showToast('error', err.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    hints,
    draft,
    setDraft,
    loading,
    saving,
    saveSecrets,
    reload: load,
  };
}
