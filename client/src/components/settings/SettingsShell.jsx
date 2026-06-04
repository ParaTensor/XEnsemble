import React, { useState } from 'react';
import { cn } from '../../lib/utils';
import {
  consoleSettingsTabActiveClass,
  consoleSettingsTabIdleClass,
} from '../../lib/consoleTokens';
import { useSecrets } from '../../hooks/useSecrets';
import GeneralSettingsPanel from './GeneralSettingsPanel';
import AgentSettingsPanel from './AgentSettingsPanel';

const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'agents', label: 'Agents' },
];

export default function SettingsShell() {
  const [section, setSection] = useState('general');
  const secretsState = useSecrets();

  return (
    <div className="flex h-full overflow-hidden rounded-lg border border-zinc-200">
      <nav className="w-32 shrink-0 flex flex-col gap-1 border-r border-zinc-200 bg-zinc-50 p-3">
        {SECTIONS.map(({ id, label }) => (
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

      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto bg-white p-4">
        {section === 'general' && <GeneralSettingsPanel secretsState={secretsState} />}
        {section === 'agents' && <AgentSettingsPanel secretsState={secretsState} />}
      </div>
    </div>
  );
}
