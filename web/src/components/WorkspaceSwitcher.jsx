import { useState, useRef, useEffect, useMemo } from 'react';
import { Box, Check, ChevronDown, Search, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

export default function WorkspaceSwitcher({ projects, activeProjectId, onSelect }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const activeProject = projects.find((p) => p.id === activeProjectId);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return projects;
    const q = query.toLowerCase();
    return projects.filter((p) => p.name?.toLowerCase().includes(q));
  }, [projects, query]);

  const select = (id) => {
    onSelect(id);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center space-x-2 text-xs font-medium text-zinc-100 bg-zinc-800 hover:bg-zinc-750 px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 shadow-sm transition"
      >
        <Box className="w-3.5 h-3.5 text-emerald-400" />
        <span className="font-bold tracking-wide">{activeProject?.name || 'Select workspace'}</span>
        <ChevronDown className={cn('w-3.5 h-3.5 text-zinc-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-80 bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl z-50 p-2 space-y-2 text-xs backdrop-blur-lg">
          <div className="px-2 py-1 flex items-center justify-between border-b border-zinc-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Workspaces</span>
            <span className="text-[10px] text-zinc-500">{projects.length} total</span>
          </div>

          <div className="relative px-1">
            <Search className="w-3 h-3 text-zinc-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search workspace..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-7 pr-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-emerald-500"
              autoFocus
            />
          </div>

          <div className="space-y-1 max-h-56 overflow-y-auto px-1">
            {filtered.length === 0 ? (
              <p className="py-3 text-center text-zinc-500">No workspaces found</p>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => select(p.id)}
                  className={cn(
                    'w-full p-2 rounded-lg border cursor-pointer flex items-center justify-between transition text-left',
                    p.id === activeProjectId
                      ? 'bg-zinc-800/90 border-emerald-500/50 text-zinc-100'
                      : 'hover:bg-zinc-800/60 border-transparent hover:border-zinc-700 text-zinc-300',
                  )}
                >
                  <div className="flex items-center space-x-2 min-w-0">
                    <Box className={cn('w-3.5 h-3.5 shrink-0', p.id === activeProjectId ? 'text-emerald-400' : 'text-zinc-500')} />
                    <span className="truncate font-medium">{p.name}</span>
                  </div>
                  {p.id === activeProjectId && (
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
