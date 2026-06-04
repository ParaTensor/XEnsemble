import React, { useState, useRef, useEffect, useId, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { consoleToolbarInputClass } from '../lib/consoleTokens';

export default function SelectMenu({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  disabled = false,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState(null);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);

  const updateMenuRect = () => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuRect({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setMenuRect(null);
      return;
    }
    updateMenuRect();
    window.addEventListener('resize', updateMenuRect);
    window.addEventListener('scroll', updateMenuRect, true);
    return () => {
      window.removeEventListener('resize', updateMenuRect);
      window.removeEventListener('scroll', updateMenuRect, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current?.contains(e.target)) return;
      if (listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (next) => {
    onChange(next);
    setOpen(false);
  };

  const list =
    open && options.length > 0 && menuRect ? (
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        style={{
          position: 'fixed',
          top: menuRect.top,
          left: menuRect.left,
          width: menuRect.width,
        }}
        className="z-[100] max-h-60 overflow-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg"
      >
        {options.map((opt) => {
          const isSelected = opt.value === value;
          return (
            <li key={opt.value} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => pick(opt.value)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  isSelected
                    ? 'bg-zinc-100 text-zinc-900'
                    : 'text-zinc-700 hover:bg-zinc-50'
                }`}
              >
                <span className="w-4 shrink-0 flex items-center justify-center">
                  {isSelected && <Check className="w-3.5 h-3.5 text-zinc-900" strokeWidth={2.5} />}
                </span>
                <span className="truncate">{opt.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    ) : null;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled || options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          consoleToolbarInputClass,
          'relative w-full text-left pr-9 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        <span className={selected ? 'text-zinc-900' : 'text-zinc-400'}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={`absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {list && createPortal(list, document.body)}
    </div>
  );
}
