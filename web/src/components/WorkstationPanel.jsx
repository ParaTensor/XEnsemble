import { useState } from 'react';
import WorkstationTabBar from './WorkstationTabBar';

// Tab content placeholders - will be replaced with actual components
function PreviewContent({ projectId }) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
      <div className="h-9 bg-zinc-900 border-b border-zinc-800 px-3 flex items-center space-x-2 text-xs shrink-0">
        <span className="text-zinc-500 font-mono text-[11px]">http://localhost:3000</span>
      </div>
      <div className="flex-1 flex items-center justify-center bg-zinc-950/60">
        <div className="text-center text-zinc-500 text-xs">
          <p>Preview will appear here</p>
          <p className="text-[10px] text-zinc-600 mt-1">Deploy your app to see live preview</p>
        </div>
      </div>
    </div>
  );
}

function DiffContent({ projectId }) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
      <div className="h-9 border-b border-zinc-800 bg-zinc-900/40 px-3 flex items-center text-xs shrink-0">
        <span className="font-mono text-zinc-400">No changes to display</span>
      </div>
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-xs">
        <p>Code diff will appear here</p>
      </div>
    </div>
  );
}

function ExplorerContent({ projectId }) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
      <div className="p-3 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between text-xs shrink-0">
        <span className="font-bold text-zinc-200">文件目录树</span>
      </div>
      <div className="flex-1 p-4 overflow-y-auto text-xs text-zinc-500">
        <p>File explorer will appear here</p>
      </div>
    </div>
  );
}

function GitContent({ projectId }) {
  return (
    <div className="flex-1 p-6 overflow-y-auto space-y-6 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <h3 className="text-base font-bold text-zinc-100">Git 交付</h3>
          <p className="text-xs text-zinc-400 mt-1">审查变更，提交并推送</p>
        </div>
      </div>
      <div className="text-xs text-zinc-500 text-center py-8">
        <p>Git operations will appear here</p>
      </div>
    </div>
  );
}

function TerminalContent({ projectId }) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-black font-mono text-xs">
      <div className="h-8 bg-zinc-900 border-b border-zinc-800 px-3 flex items-center justify-between text-zinc-400 text-[11px] shrink-0">
        <span className="flex items-center space-x-1.5">
          <span>Terminal</span>
        </span>
        <span className="text-emerald-400">● Connected</span>
      </div>
      <div className="flex-1 p-3 text-zinc-300">
        <div className="text-zinc-500">Welcome to XEnsemble Sandbox</div>
        <div><span className="text-emerald-400">$</span> _</div>
      </div>
    </div>
  );
}

function DeployContent({ projectId }) {
  return (
    <div className="flex-1 p-6 overflow-y-auto space-y-6 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <h3 className="text-base font-bold text-zinc-100">云端部署</h3>
          <p className="text-xs text-zinc-400 mt-1">将当前 Workspace 部署到云端</p>
        </div>
      </div>
      <div className="text-xs text-zinc-500 text-center py-8">
        <p>Deployment options will appear here</p>
      </div>
    </div>
  );
}

const TAB_CONTENT = {
  preview: PreviewContent,
  diff: DiffContent,
  explorer: ExplorerContent,
  git: GitContent,
  terminal: TerminalContent,
  deploy: DeployContent,
};

export default function WorkstationPanel({
  projectId,
  changeCount = 0,
  previewDevice,
  onSetPreviewDevice,
  onReloadPreview,
}) {
  const [activeTab, setActiveTab] = useState('preview');

  const TabContent = TAB_CONTENT[activeTab] || PreviewContent;

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-zinc-950">
      <WorkstationTabBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        changeCount={changeCount}
        previewDevice={previewDevice}
        onSetPreviewDevice={onSetPreviewDevice}
        onReloadPreview={onReloadPreview}
      />
      <TabContent projectId={projectId} />
    </section>
  );
}
