import { useMemo } from 'react';
import { Bot, Plus, Disc } from 'lucide-react';
import SessionCard from './SessionCard';
import { isArchivedSession } from '../lib/sidebarPrefs';
import { formatRelativeTime } from '../lib/formatRelativeTime';

function sortSessions(list, prefs) {
  return [...list].sort((a, b) => {
    const aPin = prefs?.pinnedSessions?.includes(a.id) ? 1 : 0;
    const bPin = prefs?.pinnedSessions?.includes(b.id) ? 1 : 0;
    if (aPin !== bPin) return bPin - aPin;
    const aLive = a.alive === true ? 1 : 0;
    const bLive = b.alive === true ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

export default function SessionSidebar({
  sessions,
  agents,
  activeSession,
  onSelectSession,
  onNewSession,
  prefs,
}) {
  const visibleSessions = useMemo(() => {
    const filtered = sessions.filter(
      (s) => !isArchivedSession(prefs, s.id) && s.status !== 'exited',
    );
    return sortSessions(filtered, prefs);
  }, [sessions, prefs]);

  const getAgent = (agentId) => agents.find((a) => a.id === agentId);

  return (
    <aside className="w-64 border-r border-zinc-800 bg-zinc-900/90 flex flex-col shrink-0">
      {/* Header */}
      <div className="p-3.5 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Bot className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold text-zinc-100 uppercase tracking-wider">Agent 会话中心</span>
        </div>
        <button
          onClick={onNewSession}
          className="px-2.5 py-1 text-zinc-200 hover:text-white bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 rounded-md text-[11px] font-medium flex items-center space-x-1 transition shadow-sm"
        >
          <Plus className="w-3 h-3" />
          <span>新建</span>
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 p-3 overflow-y-auto space-y-2">
        {visibleSessions.length === 0 ? (
          <p className="py-4 text-center text-xs text-zinc-500">
            No sessions yet. Click "新建" to start one.
          </p>
        ) : (
          visibleSessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              agent={getAgent(session.agentId)}
              isActive={activeSession?.sessionId === session.id}
              onClick={() => onSelectSession(session)}
            />
          ))
        )}
      </div>

      {/* Bottom Status */}
      <div className="p-3 border-t border-zinc-800 bg-zinc-950/60 text-[11px] text-zinc-400 flex items-center justify-between">
        <span className="flex items-center space-x-1.5 text-purple-400">
          <Disc className="w-3.5 h-3.5" />
          <span>Agent Registry</span>
        </span>
      </div>
    </aside>
  );
}
