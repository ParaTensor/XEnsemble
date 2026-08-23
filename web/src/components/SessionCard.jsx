import { cn } from '../lib/utils';
import { formatRelativeTime } from '../lib/formatRelativeTime';
import { Box, Trash2 } from 'lucide-react';
import { consoleIconButtonDangerClass } from '../lib/consoleTheme';

export default function SessionCard({ session, agent, isActive, onClick, onDelete }) {
  const isAlive = session.alive === true;
  const label = session.title?.trim() || agent?.name || session.agentId || 'Session';
  const timestamp = session.createdAt ? formatRelativeTime(session.createdAt) : '';

  return (
    <div
      onClick={onClick}
      className={cn(
        'group p-3 rounded-xl text-xs cursor-pointer transition',
        isActive
          ? 'bg-zinc-800/90 border-2 border-emerald-500/80 shadow-sm'
          : 'bg-zinc-950/70 hover:bg-zinc-800/50 border border-zinc-800 hover:border-zinc-700',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center space-x-2 font-semibold min-w-0">
          <span className={cn(
            'w-2.5 h-2.5 rounded-full shrink-0',
            isAlive ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600',
          )} />
          <span className={cn('truncate', isActive ? 'text-zinc-100' : 'text-zinc-300')}>
            {label}
          </span>
        </div>
        <span className={cn(
          'text-[10px] shrink-0 ml-2',
          isActive ? 'text-emerald-300 bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-800/60 font-semibold' : 'text-zinc-500',
        )}>
          {isActive ? 'Active' : timestamp || 'Idle'}
        </span>
        {onDelete && (
          <button
            type="button"
            title="Delete session"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(session.id);
            }}
            className={cn(
              consoleIconButtonDangerClass,
              'shrink-0 ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity',
            )}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Description */}
      {session.projectName && (
        <p className={cn('text-[11px] leading-snug truncate', isActive ? 'text-zinc-300' : 'text-zinc-400')}>
          {session.projectName}
        </p>
      )}

      {/* Footer */}
      <div className="mt-2 text-[10px] flex items-center justify-between font-mono border-t border-zinc-800/50 pt-1.5">
        <span className="flex items-center space-x-1 text-zinc-500">
          <Box className="w-2.5 h-2.5" />
          <span className="truncate max-w-[120px]">{session.projectName || 'workspace'}</span>
        </span>
        <span className="text-zinc-500">{timestamp}</span>
      </div>
    </div>
  );
}
