import GatewaySettingsPanel from '../components/settings/GatewaySettingsPanel';
import PageHeader from '../components/PageHeader';

export default function GatewayAdmin() {
  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader title="Gateway" />
      <div className="min-h-0 flex-1">
        <GatewaySettingsPanel />
      </div>
    </div>
  );
}
