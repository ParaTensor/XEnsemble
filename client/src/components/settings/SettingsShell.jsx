import React, { useState, useContext } from 'react';
import { AuthContext } from '../../App';
import { cn } from '../../lib/utils';
import {
  consoleSettingsTabActiveClass,
  consoleSettingsTabIdleClass,
} from '../../lib/consoleTokens';
import { useSecrets } from '../../hooks/useSecrets';
import GeneralSettingsPanel from './GeneralSettingsPanel';
import AgentSettingsPanel from './AgentSettingsPanel';
import QuotaSettingsPanel from './QuotaSettingsPanel';
import PlatformSettingsPanel from './PlatformSettingsPanel';

const BASE_SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'agents', label: 'Agents' },
  { id: 'quota', label: 'Quota' },
];

const ADMIN_SECTION = { id: 'platform', label: 'Platform' };

export default function SettingsShell() {
  const { user } = useContext(AuthContext);
  const [section, setSection] = useState('general');
  const secretsState = useSecrets();
  const sections = user?.role === 'admin'
    ? [...BASE_SECTIONS, ADMIN_SECTION]
    : BASE_SECTIONS;

  return (
    <div className="flex h-full overflow-hidden rounded-lg border border-zinc-200">
      <nav className="w-32 shrink-0 flex flex-col gap-1 border-r border-zinc-200 bg-zinc-50 p-3">
        {sections.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={cn(
              'w-full px-3 py-2 rounded-md text-sm font-bold text-left transition-colors',
              section === id ? consoleSettingsTabActiveClass : consoleSettingsTabIdleClass,
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto bg-white p-3">
        {section === 'general' && <GeneralSettingsPanel secretsState={secretsState} />}
        {section === 'agents' && <AgentSettingsPanel secretsState={secretsState} />}
        {section === 'quota' && <QuotaSettingsPanel />}
        {section === 'platform' && user?.role === 'admin' && <PlatformSettingsPanel />}
      </div>
    </div>
  );
}
