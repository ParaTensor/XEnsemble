import { useState, useEffect } from 'react';
import { Loader2, Server } from 'lucide-react';
import { cn } from '../../lib/utils';
import { apiFetch } from '../../lib/api';
import { useToast } from '../Toast';
import { buttonClass } from '../../lib/buttonStyles';
import {
  consoleSectionLabelClass,
  consoleInputClass,
} from '../../lib/consoleTokens';

const BLAXEL_FIELDS = [
  { key: 'BLAXEL_WORKSPACE', label: 'Workspace', placeholder: 'your-workspace', type: 'text' },
  { key: 'BLAXEL_API_KEY', label: 'API Key', placeholder: 'sk-...', type: 'password' },
  { key: 'BLAXEL_REGION', label: 'Region', placeholder: 'us-pdx-1', type: 'text' },
  { key: 'BLAXEL_SANDBOX_IMAGE', label: 'Sandbox Image', placeholder: 'blaxel/base-image:latest', type: 'text' },
  { key: 'BLAXEL_SANDBOX_MEMORY', label: 'Memory (MB)', placeholder: '4096', type: 'text' },
];

export default function RuntimeSettingsPanel() {
  const { showToast } = useToast();
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch('/api/v1/admin/platform-settings')
      .then((r) => r.json())
      .then((data) => {
        const settings = data.settings || data || {};
        const map = {};
        for (const f of BLAXEL_FIELDS) {
          map[f.key] = settings[f.key] || '';
        }
        setValues(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/v1/admin/platform-settings', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      showToast('success', 'Runtime settings saved.');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Server className="w-4 h-4 text-zinc-400" />
        <h3 className={cn(consoleSectionLabelClass)}>Blaxel Runtime</h3>
      </div>
      <p className="text-xs text-zinc-500">
        配置 Blaxel 云端沙箱服务。获取 API Key: <a href="https://app.blaxel.ai" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">app.blaxel.ai</a>
      </p>

      <div className="space-y-4">
        {BLAXEL_FIELDS.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-300">{f.label}</label>
            <input
              type={f.type}
              value={values[f.key] || ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className={cn(consoleInputClass, 'font-mono text-xs')}
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(buttonClass('primary', 'sm'), 'min-w-[120px]')}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
        </button>
      </div>
    </div>
  );
}
