import GatewaySettingsPanel from '../components/settings/GatewaySettingsPanel';
import PageHeader from '../components/PageHeader';
import { consoleAdminPageClass } from '../lib/consoleTokens';

export default function GatewayAdmin() {
  return (
    <div className={consoleAdminPageClass}>
      <PageHeader title="Gateway" />
      <div className="min-h-0 flex-1">
        <GatewaySettingsPanel />
      </div>
    </div>
  );
}
