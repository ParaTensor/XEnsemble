import { cn } from '../lib/utils';
import {
  PlayCircle,
  FileCode,
  FolderTree,
  GitCommit,
  Terminal,
  Cloud,
  Monitor,
  Smartphone,
  RotateCw,
} from 'lucide-react';

const TABS = [
  { id: 'preview', label: 'Web 预览', icon: PlayCircle, iconColor: 'text-blue-400' },
  { id: 'diff', label: 'Diff', icon: FileCode, iconColor: 'text-emerald-400' },
  { id: 'explorer', label: '文件目录树', icon: FolderTree, iconColor: 'text-emerald-400' },
  { id: 'git', label: 'Git 交付', icon: GitCommit, iconColor: 'text-amber-400' },
  { id: 'terminal', label: '沙盒 Terminal', icon: Terminal, iconColor: 'text-zinc-400' },
  { id: 'deploy', label: '云端部署', icon: Cloud, iconColor: 'text-purple-400' },
];

export default function WorkstationTabBar({
  activeTab,
  onSelectTab,
  changeCount = 0,
  previewDevice,
  onSetPreviewDevice,
  onReloadPreview,
}) {
  return (
    <div className="h-10 border-b border-zinc-800 bg-zinc-900/70 px-3 flex items-center justify-between shrink-0">
      {/* Tabs */}
      <div className="flex items-center space-x-1 overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={cn(
                'px-3 py-1.5 rounded-t text-xs font-medium flex items-center space-x-1.5 shrink-0 transition',
                isActive
                  ? 'bg-zinc-800 text-zinc-100 border-t-2 border-blue-500 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40',
              )}
            >
              <Icon className={cn('w-3.5 h-3.5', tab.iconColor)} />
              <span>{tab.label}</span>
              {tab.id === 'explorer' && changeCount > 0 && (
                <span className="px-1.5 py-0.2 text-[9px] bg-amber-950 text-amber-300 border border-amber-800/60 rounded-full font-mono">
                  {changeCount} 改动
                </span>
              )}
              {tab.id === 'preview' && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
          );
        })}
      </div>

      {/* Right Controls */}
      <div className="flex items-center space-x-2 text-xs shrink-0">
        {activeTab === 'preview' && (
          <>
            <div className="flex items-center space-x-1 bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-800 text-zinc-400">
              <button
                onClick={() => onSetPreviewDevice?.('desktop')}
                className={cn('p-1 rounded', previewDevice === 'desktop' ? 'text-blue-400' : 'text-zinc-500 hover:text-white')}
                title="桌面端"
              >
                <Monitor className="w-3 h-3" />
              </button>
              <button
                onClick={() => onSetPreviewDevice?.('mobile')}
                className={cn('p-1 rounded', previewDevice === 'mobile' ? 'text-blue-400' : 'text-zinc-500 hover:text-white')}
                title="移动端"
              >
                <Smartphone className="w-3 h-3" />
              </button>
            </div>
            <button
              onClick={onReloadPreview}
              title="重新加载"
              className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
