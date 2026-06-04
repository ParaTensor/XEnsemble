import React, { useMemo } from 'react';
import Button from '../Button';
import { PLATFORM_SECRET_KEYS } from '../../lib/secretLabels';
import SecretFields from './SecretFields';

export default function GeneralSettingsPanel({ secretsState }) {
  const { secrets, setSecrets, loading, saving, saveSecrets } = secretsState;
  const generalKeys = PLATFORM_SECRET_KEYS;

  const savedHints = useMemo(() => {
    const hints = {};
    generalKeys.forEach((k) => {
      if (secrets[k]) hints[k] = true;
    });
    return hints;
  }, [secrets, generalKeys]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {};
    generalKeys.forEach((k) => {
      const v = secrets[k]?.trim();
      if (v) payload[k] = v;
    });
    await saveSecrets(payload, { successMessage: 'Platform settings saved.' });
  };

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading...</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="h-full flex flex-col">
      <div className="flex-1 min-h-0">
        <SecretFields
          keys={generalKeys}
          secrets={secrets}
          savedHints={savedHints}
          onChange={(key, value) => setSecrets((prev) => ({ ...prev, [key]: value }))}
        />
      </div>
      <div className="pt-6 flex justify-end shrink-0">
        <Button type="submit" disabled={saving} size="md">
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
