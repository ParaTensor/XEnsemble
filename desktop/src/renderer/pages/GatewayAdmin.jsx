import React from 'react';
import PageHeader from '../components/PageHeader';
import GatewaySettingsPanel from '../components/settings/GatewaySettingsPanel';

export default function GatewayAdmin() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto console-scroll-hidden p-6">
      <PageHeader
        title="Gateway"
        description="Manage the LLM proxy process and configure providers for agents."
      />
      <div className="mt-5 min-h-0 flex-1">
        <GatewaySettingsPanel />
      </div>
    </div>
  );
}
