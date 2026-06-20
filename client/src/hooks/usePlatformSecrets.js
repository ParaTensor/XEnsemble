import { useState, useEffect, useCallback, useContext } from 'react';

import { useToast } from '../components/Toast';

import { apiFetch } from '../lib/api';

export function usePlatformSecrets() {
  
  const { showToast } = useToast();
  const [hints, setHints] = useState({});
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    
    setLoading(true);
    return apiFetch('/api/v1/admin/agent-secrets')
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data === 'object' && !data.error) {
          setHints(data);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveSecrets = async (payload, { successMessage = 'Platform settings saved.' } = {}) => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/v1/admin/agent-secrets', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
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
