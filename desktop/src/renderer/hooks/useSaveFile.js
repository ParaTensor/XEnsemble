import { useState, useCallback } from 'react';

export function useSaveFile({ projectId, writeFile, onSaved, showToast }) {
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(null);

  const save = useCallback(async (path, content) => {
    setSaving(true);
    setConflict(null);
    try {
      const result = await writeFile(projectId, path, content);
      showToast?.('success', 'Saved');
      onSaved?.(path, content);
      return true;
    } catch (err) {
      if (err.status === 409) {
        setConflict({ path, content });
        showToast?.('error', 'Conflict: file was modified externally');
      } else {
        showToast?.('error', err.message || 'Save failed');
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [projectId, writeFile, onSaved, showToast]);

  const resolveConflict = useCallback((action) => {
    if (action === 'overwrite') {
      setConflict(null);
      return save(conflict.path, conflict.content);
    }
    setConflict(null);
    return null;
  }, [conflict, save]);

  return { save, saving, conflict, resolveConflict };
}