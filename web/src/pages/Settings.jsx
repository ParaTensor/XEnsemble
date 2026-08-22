import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import SettingsShell from '../components/settings/SettingsShell';

export default function Settings() {
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Header */}
      <div className="shrink-0 border-b border-zinc-800 px-6 py-4 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-lg font-bold text-zinc-100">Settings</h1>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 p-6">
        <SettingsShell />
      </div>
    </div>
  );
}
