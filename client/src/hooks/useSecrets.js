import { useState, useEffect, useCallback, useContext } from 'react';
import { AuthContext } from '../App';
import { useToast } from '../components/Toast';

export function useSecrets() {
  const { token } = useContext(AuthContext);
  const { showToast } = useToast();
  const [secrets, setSecrets] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return fetch('http://localhost:3000/api/v1/secrets', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data === 'object' && !data.error) {
          setSecrets(data);
        }
      })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const saveSecrets = async (payload, { successMessage = 'Saved successfully.' } = {}) => {
    setSaving(true);
    try {
      const res = await fetch('http://localhost:3000/api/v1/secrets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
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
