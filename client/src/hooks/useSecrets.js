import { useState, useEffect, useCallback, useContext } from 'react';

import { useToast } from '../components/Toast';
import { apiFetch } from '../lib/api';

export function useSecrets() {
  
  const { showToast } = useToast();
  const [secrets, setSecrets] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    
    setLoading(true);
    return apiFetch('/api/v1/secrets')
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data === 'object' && !data.error) {
          setSecrets(data);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveSecrets = async (payload, { successMessage = 'Saved successfully.' } = {}) => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/v1/secrets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.secrets) setSecrets(data.secrets);
        else await load();
        showToast('success', successMessage);
        return true;
      }
      showToast('error', 'Failed to save.');
      return false;
    } catch (err) {
      showToast('error', err.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    secrets,
    setSecrets,
    loading,
    saving,
    saveSecrets,
    reload: load,
  };
}
