import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, GitBranch, Loader2, Plus } from 'lucide-react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import Input, { FormLabel } from '../Input';
import * as githubApi from '../../lib/githubApi.js';
import { useToast } from '../Toast';
import {
  consoleMenuDropdownZClass,
  consoleDropdownPanelClass,
  consoleToolbarInputClass,
  textPlaceholder,
  textPrimary,
  textSecondary,
} from '../../lib/consoleTheme';

export default function BranchSelector({ projectId, currentBranch, onBranchChanged }) {
  const { showToast } = useToast();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchBase, setNewBranchBase] = useState('');
  const [switching, setSwitching] = useState(false);
  const [menuRect, setMenuRect] = useState(null);
  const rootRef = useRef(null);

  const loadBranches = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const { branches: rows } = await githubApi.listBranches(projectId);
      setBranches(Array.isArray(rows) ? rows : []);
      if (!newBranchBase) {
        const current = rows.find((b) => b.current);
        setNewBranchBase(current?.name || rows[0]?.name || 'main');
      }
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId, showToast, newBranchBase]);

  useEffect(() => {
    if (open) {
      loadBranches();
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) {
        setMenuRect({ top: rect.bottom + 4, left: rect.left, width: rect.width });
      }
    } else {
      setMenuRect(null);
      setCreating(false);
    }
  }, [open, loadBranches]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const handleSwitch = async (name) => {
    if (!projectId || name === currentBranch) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      await githubApi.switchBranch(projectId, name);
      showToast('success', `Switched to branch ${name}`);
      onBranchChanged?.();
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setSwitching(false);
      setOpen(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!projectId || !newBranchName.trim()) return;
    try {
      await githubApi.createBranch(projectId, newBranchName.trim(), newBranchBase);
      showToast('success', `Created branch ${newBranchName.trim()}`);
      setNewBranchName('');
      setCreating(false);
      await loadBranches();
      onBranchChanged?.();
    } catch (err) {
      showToast('error', err.message);
    }
  };

  if (!projectId) return null;

  const currentLabel = currentBranch || 'unknown';

  const dropdown = open && menuRect ? (
    <div
      style={{
        position: 'fixed',
        top: menuRect.top,
        left: menuRect.left,
        width: Math.max(menuRect.width, 224),
      }}
      className={`${consoleMenuDropdownZClass} ${consoleDropdownPanelClass} max-h-80 overflow-hidden shadow-md`}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 p-4 text-sm text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading branches…
        </div>
      ) : (
        <div className="flex max-h-80 flex-col">
          <ul className="min-h-0 flex-1 overflow-auto py-1">
            {branches.map((b) => (
              <li key={b.name}>
                <button
                  type="button"
                  onClick={() => handleSwitch(b.name)}
                  disabled={switching}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                >
                  <span className="flex h-3.5 w-3.5 items-center justify-center">
                    {b.name === currentBranch && <Check className="h-3.5 w-3.5 text-zinc-900" />}
                  </span>
                  <span className="min-w-0 truncate">{b.name}</span>
                  {b.current && (
                    <span className="ml-auto shrink-0 text-[10px] text-zinc-400">current</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {!creating ? (
            <div className="border-t border-zinc-100 p-2">
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-50"
              >
                <Plus className="h-3.5 w-3.5" />
                New branch
              </button>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="border-t border-zinc-100 p-3 space-y-2">
              <FormLabel htmlFor="new-branch-name">Branch name</FormLabel>
              <Input
                id="new-branch-name"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                placeholder="feature/my-change"
                autoFocus
              />
              <FormLabel htmlFor="new-branch-base">Base branch</FormLabel>
              <select
                id="new-branch-base"
                value={newBranchBase}
                onChange={(e) => setNewBranchBase(e.target.value)}
                className={consoleToolbarInputClass}
              >
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>{b.name}</option>
                ))}
              </select>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="text-xs text-zinc-500 hover:text-zinc-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newBranchName.trim()}
                  className="rounded-md bg-black px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        title="Switch branch"
        aria-label="Current branch"
        className={cn(
          consoleToolbarInputClass,
          'relative flex items-center gap-2 pr-7 text-left text-xs',
        )}
      >
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        <span className="min-w-0 truncate">{currentLabel}</span>
        <ChevronDown
          className={`pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {dropdown && createPortal(dropdown, document.body)}
    </div>
  );
}
