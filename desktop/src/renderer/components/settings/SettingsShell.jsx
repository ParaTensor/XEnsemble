import React, { useState, useContext } from 'react';
import { AuthContext } from '../../App';
import { cn } from '../../lib/utils';
import {
  consoleSettingsPanelScrollClass,
  consoleSettingsTabActiveClass,
  consoleSettingsTabIdleClass,
} from '../../lib/consoleTheme';
import { useSecrets } from '../../hooks/useSecrets';
import GeneralSettingsPanel from './GeneralSettingsPanel';
import QuotaSettingsPanel from './QuotaSettingsPanel';
import GatewaySettingsPanel from './GatewaySettingsPanel';
import AgentSettingsPanel from './AgentSettingsPanel';
import TerminalSettingsPanel from './TerminalSettingsPanel';

const QUOTA_SECTION = { id: 'quota', label: 'Quota' };
const GENERAL_SECTION = { id: 'general', label: 'General' };
const TERMINAL_SECTION = { id: 'terminal', label: 'Terminal' };
const BYOK_SECTION = { id: 'byok', label: 'BYOK' };
const GATEWAY_SECTION = { id: 'gateway', label: 'Gateway' };
export default function SettingsShell() {
  const { user, token } = useContext(AuthContext);
  const [section, setSection] = useState('general');
  const secretsState = useSecrets();

  const sections = [
    GENERAL_SECTION,
    TERMINAL_SECTION,
    ...(user?.role === 'admin' ? [GATEWAY_SECTION] : []),
    BYOK_SECTION,
    QUOTA_SECTION,
  ];

  return (
    <div className="flex h-full overflow-hidden rounded-lg border border-[#E8EAED]">
      <nav className="w-32 shrink-0 flex flex-col gap-1 border-r border-[#E8EAED] bg-[#F4F5F6] p-3">
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

      <div className={consoleSettingsPanelScrollClass}>
        {section === 'general' && <GeneralSettingsPanel />}
        {section === 'terminal' && <TerminalSettingsPanel />}
        {section === 'gateway' && user?.role === 'admin' && <GatewaySettingsPanel />}
        {section === 'byok' && <AgentSettingsPanel secretsState={secretsState} />}
        {section === 'quota' && <QuotaSettingsPanel />}
      </div>
    </div>
  );
}
