import { useState, useContext } from 'react';
import { AuthContext } from '../../App';
import { cn } from '../../lib/utils';
import GeneralSettingsPanel from './GeneralSettingsPanel';
import ApiKeysSettingsPanel from './ApiKeysSettingsPanel';
import GitHubSettingsPanel from './GitHubSettingsPanel';
import GitProvidersSettingsPanel from './GitProvidersSettingsPanel';
import RuntimeSettingsPanel from './RuntimeSettingsPanel';
import QuotaSettingsPanel from './QuotaSettingsPanel';

const QUOTA_SECTION = { id: 'quota', label: 'Quota' };
const GENERAL_SECTION = { id: 'general', label: 'General' };
const API_KEYS_SECTION = { id: 'api-keys', label: 'API Keys' };
const GITHUB_SECTION = { id: 'github', label: 'Git' };
const GIT_PROVIDERS_SECTION = { id: 'git-providers', label: 'Git' };
const RUNTIME_SECTION = { id: 'runtime', label: 'Runtime' };

export default function SettingsShell() {
  const { user } = useContext(AuthContext);
  const [section, setSection] = useState('general');
  const isAdmin = user?.role === 'admin';

  const sections = [
    GENERAL_SECTION,
    API_KEYS_SECTION,
    ...(isAdmin ? [GIT_PROVIDERS_SECTION, RUNTIME_SECTION] : [GITHUB_SECTION]),
    QUOTA_SECTION,
  ];

  return (
    <div className="flex h-full overflow-hidden rounded-lg border border-zinc-800">
      <nav className="w-40 shrink-0 flex flex-col gap-1 border-r border-zinc-800 bg-zinc-900 p-3">
        {sections.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={cn(
              'w-full px-3 py-2 rounded-md text-sm font-medium text-left transition-colors',
              section === id
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50',
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="flex-1 min-h-0 overflow-y-auto bg-zinc-950 px-6 py-5">
        {section === 'general' && <GeneralSettingsPanel />}
        {section === 'api-keys' && <ApiKeysSettingsPanel />}
        {section === 'git-providers' && <GitProvidersSettingsPanel />}
        {section === 'github' && <GitHubSettingsPanel />}
        {section === 'runtime' && <RuntimeSettingsPanel />}
        {section === 'quota' && <QuotaSettingsPanel />}
      </div>
    </div>
  );
}
