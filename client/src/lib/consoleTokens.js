/** Console tokens — aligned with ParaRouter DESIGN.md */

export const consoleBackdropClass = 'fixed inset-0 bg-black/50';

export const consoleDialogPanelClass =
  'relative w-full bg-white border border-zinc-200 shadow-sm rounded-lg text-left flex flex-col overflow-hidden';

export const consoleInputClass =
  'w-full bg-white border border-zinc-300 rounded-md px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-black focus:ring-1 focus:ring-black transition-colors';

export const consoleToolbarControlClass = 'h-9 min-h-9 text-sm';

export const consoleToolbarInputClass = `${consoleInputClass} ${consoleToolbarControlClass} py-1.5`;

export const consolePageStackClass = 'space-y-6';

export const consoleTableShellClass =
  'bg-white border border-zinc-200 rounded-lg overflow-hidden shadow-sm';

export const consoleTableHeadCellClass =
  'px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider';

export const consoleTableBodyCellClass = 'px-4 py-3 text-sm text-zinc-700';

export const consoleCardClass = 'bg-white border border-zinc-200 rounded-lg shadow-sm';

export const consoleNavActiveClass = 'text-zinc-900 font-medium';

export const consoleNavIdleClass = 'text-zinc-600 hover:text-zinc-900 transition-colors';

export const consoleSettingsTabActiveClass =
  'bg-black text-white shadow-lg shadow-black/10';

export const consoleSettingsTabIdleClass =
  'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900';

export const consoleSectionLabelClass =
  'text-xs font-semibold uppercase tracking-wider text-zinc-500';
