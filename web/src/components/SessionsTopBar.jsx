import { Square, Play, RefreshCw, Settings2, PanelRightOpen, PanelRightClose, Unplug } from 'lucide-react';
import WorkspaceSwitcher from './WorkspaceSwitcher';

export default function SessionsTopBar({
  projects,
  activeProject,
  activeSession,
  sessionAlive,
  sessionPending,
  sessionFailed,
  sessionWakeable,
  user,
  panelOpen,
  onTogglePanel,
  onStopSession,
  onRestartSession,
  onDisconnect,
  onNewSession,
  onSelectWorkspace,
}) {
  return (
    <div className="h-12 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0 bg-zinc-900 z-30">
      {/* Left: Brand + Workspace Switcher */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2 font-bold tracking-wider text-sm bg-zinc-800 px-2.5 py-1 rounded-md border border-zinc-700">
          <span className="text-emerald-400 text-xs">◆</span>
          <span className="text-zinc-100">XEnsemble</span>
        </div>
        <span className="text-zinc-600">/</span>
        <WorkspaceSwitcher
          projects={projects}
          activeProjectId={activeProject?.id}
          onSelect={onSelectWorkspace}
        />
      </div>

      {/* Center: Session Info */}
      <div className="flex items-center space-x-3">
        {activeSession ? (
          <>
            <div className="flex items-center space-x-2 text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="font-semibold text-zinc-100">
                {activeSession.projectName || activeSession.agentName}
              </span>
            </div>
            <span className="text-[10px] text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded">
              {activeSession.agentName}
            </span>
          </>
        ) : (
          <span className="text-xs text-zinc-500">Select a session to start</span>
        )}
      </div>

      {/* Right: Controls */}
      <div className="flex items-center space-x-2">
        {activeSession && (
          <>
            {/* Session controls */}
            <div className="flex items-center space-x-1 border-r border-zinc-800 pr-2 mr-1">
              {!sessionPending && !sessionFailed && (
                <>
                  {sessionAlive ? (
                    <button
                      onClick={onStopSession}
                      className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
                      title="Pause session"
                    >
                      <Square className="w-4 h-4" />
                    </button>
                  ) : sessionWakeable ? (
                    <button
                      onClick={onRestartSession}
                      className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
                      title="Resume session"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  ) : null}
                  {sessionAlive && (
                    <button
                      onClick={onRestartSession}
                      className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
                      title="Restart session"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  )}
                </>
              )}
              <button
                onClick={onDisconnect}
                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
                title="Disconnect"
              >
                <Unplug className="w-4 h-4" />
              </button>
            </div>

            {/* Panel toggle */}
            <button
              onClick={onTogglePanel}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
              title={panelOpen ? 'Hide panel' : 'Show panel'}
            >
              {panelOpen ? (
                <PanelRightClose className="w-4 h-4" />
              ) : (
                <PanelRightOpen className="w-4 h-4" />
              )}
            </button>
          </>
        )}

        {/* User avatar */}
        <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-purple-500 to-emerald-500 flex items-center justify-center font-bold text-white text-xs ring-1 ring-zinc-700 ml-1">
          {(user?.username || 'U').charAt(0).toUpperCase()}
        </div>
      </div>
    </div>
  );
}
