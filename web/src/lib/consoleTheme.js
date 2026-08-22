/** Console tokens — Dark zinc theme (Mock design). */

export const bgCanvas = 'bg-zinc-950';
export const bgContainer = 'bg-zinc-900';
export const bgSecondary = 'bg-zinc-900/90';
export const bgTertiary = 'bg-zinc-950/70';
export const bgActive = 'bg-zinc-800';
export const bgInverse = 'bg-zinc-100';

export const textPrimary = 'text-zinc-100';
export const textSecondary = 'text-zinc-400';
export const textTertiary = 'text-zinc-300';
export const textPlaceholder = 'text-zinc-500';
export const textInverse = 'text-zinc-950';

export const borderHairline = 'border-zinc-800';
export const borderSubtle = 'border-zinc-700';

export const divideHairline = 'divide-zinc-800';

export const accentBlue = 'text-blue-400 hover:text-blue-300';
export const accentBlueBg = 'bg-blue-400 hover:bg-blue-300';
export const accentGreen = 'text-emerald-400';
export const accentGreenBg = 'bg-emerald-950';
export const accentGreenText = 'text-emerald-400';
export const accentRed = 'text-red-400 hover:text-red-300';
export const accentRedBg = 'bg-red-500/10 hover:bg-red-500/20';

export {
  XTERM_MINIMUM_CONTRAST_RATIO as xtermMinimumContrastRatio,
  getTerminalTheme,
  getDefaultTerminalThemeId,
} from './terminalThemes.js';

import { getTerminalTheme, getDefaultTerminalThemeId } from './terminalThemes.js';
import { loadTerminalThemeId } from './terminalPrefs.js';

export function getActiveXtermTheme() {
  return getTerminalTheme(loadTerminalThemeId()).xterm;
}

export const xtermTheme = getTerminalTheme(getDefaultTerminalThemeId()).xterm;
export const xtermBackground = xtermTheme.background;

export const panelPadding = 'p-3';
export const headerPadding = 'px-3 py-2';
export const compactRadius = 'rounded-lg';
export const containerRadius = 'rounded-2xl';
export const transitionBase = 'transition-colors duration-150 ease-in-out';

export const hoverBgSecondary = 'hover:bg-zinc-800/60';
export const hoverBgCanvas = 'hover:bg-zinc-900';
export const hoverBgTertiary = 'hover:bg-zinc-800/50';
export const hoverBgActive = 'hover:bg-zinc-700';
export const hoverTextPrimary = 'hover:text-zinc-100';
export const hoverTextSecondary = 'hover:text-zinc-300';

export const consoleBackdropClass = 'fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity';

export const consoleDialogPanelClass =
  `relative bg-zinc-900 border border-zinc-800 shadow-2xl rounded-2xl text-zinc-100 text-left flex flex-col overflow-hidden`;

export const consoleDialogSmClass =
  `${consoleDialogPanelClass} w-full max-w-sm max-w-[calc(100vw-2rem)]`;

export const consoleDialogMdClass =
  `${consoleDialogPanelClass} w-[480px] max-w-[calc(100vw-2rem)]`;

export const consoleDialogLgClass =
  `${consoleDialogPanelClass} w-[560px] max-w-[calc(100vw-2rem)]`;

export const consoleStructuredDialogPanelClass =
  `${consoleDialogMdClass} flex flex-col max-h-[90vh] overflow-hidden p-0`;

export const consoleStructuredDialogHeaderClass =
  'px-4 py-3 border-b border-zinc-800 shrink-0 bg-zinc-900';

export const consoleStructuredDialogBodyClass =
  'flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4 console-scroll-hidden';

export const consoleStructuredDialogFooterClass =
  'border-t border-zinc-800 px-4 py-3 bg-zinc-950/70 flex justify-end gap-2 shrink-0';

export const consoleDialogAdminFormPanelClass =
  'relative bg-zinc-900 border border-zinc-800 shadow-2xl rounded-2xl text-left w-[480px] max-w-[calc(100vw-2rem)]';

export const consoleInputClass =
  'w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors duration-150 ease-in-out';

export const consoleToolbarControlClass = 'h-9 min-h-9 text-sm';

export const consoleToolbarInputClass = `${consoleInputClass} ${consoleToolbarControlClass} py-1.5`;

export const consolePageStackClass = 'space-y-6';

export const consolePageTitleClass = 'text-2xl font-bold tracking-tight text-zinc-100';

export const consoleAdminPageClass = 'flex h-full min-h-0 w-full flex-col gap-6';

export const consoleToolPageClass =
  'flex h-full min-h-0 w-full flex-col bg-zinc-900 text-zinc-100';

export const consoleAdminTableScrollClass = 'min-h-0 flex-1 overflow-auto console-scroll-hidden';

export const consoleTableShellClass =
  'bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden shadow-sm';

export const consoleAdminTableShellClass =
  `${consoleTableShellClass} flex min-h-0 flex-1 flex-col`;

export const consoleTableHeadRowClass = 'bg-zinc-950/70 border-b border-zinc-800';

export const consoleTableBodyDivideClass = 'divide-y divide-zinc-800';

export const consoleTableBodyRowClass = 'hover:bg-zinc-950/70 transition-colors';

export const consoleTableHeadCellClass =
  'px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider';

export const consoleTableBodyCellClass = 'px-4 py-3 text-sm text-zinc-300';

export const consoleTableHeadCellDenseClass =
  'px-3 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider';

export const consoleTableBodyCellDenseClass = 'px-3 py-3 text-sm text-zinc-300';

export const consoleTableSectionHeaderClass =
  'px-4 py-3 border-b border-zinc-800 flex items-center justify-between';

export const consoleCardClass = 'bg-zinc-900 border border-zinc-800 rounded-xl shadow-sm';

export const consoleFormLabelClass =
  'block text-xs font-semibold uppercase tracking-wider text-zinc-400';

export const consoleSectionLabelClass = consoleFormLabelClass;

export const consoleDropdownPanelClass =
  'rounded-xl border border-zinc-700/80 bg-zinc-900 shadow-2xl backdrop-blur-lg';

export const consoleFilterToolbarClass =
  'bg-zinc-900 border border-zinc-800 rounded-lg p-4 sm:p-5 shadow-sm space-y-4';

export const consoleStatValueClass =
  'text-2xl font-bold tracking-tight text-zinc-100';

export const consoleEmptyStateClass =
  'flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70';

export const consoleNavActiveClass = 'bg-zinc-800 text-zinc-100';

export const consoleNavIdleClass =
  'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200';

export const consoleSettingsTabActiveClass =
  'bg-zinc-100 text-zinc-950 shadow-lg shadow-black/20';

export const consoleSettingsTabIdleClass =
  'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200';

export const consoleSettingsPanelScrollClass =
  'flex-1 min-h-0 min-w-0 overflow-y-auto console-scroll-hidden bg-zinc-950 px-5 py-4';

export const consoleStatusBadgeClass =
  'inline-flex items-center gap-1 min-w-[6.5rem] h-4 text-xs';

export const consoleStatusIconSlotClass =
  'inline-flex w-3 h-3 shrink-0 items-center justify-center';

export const consoleMenuDropdownZClass = 'z-[110]';

/** Buttons: no focus ring/outline on click or keyboard focus. */
export const consoleButtonFocusClass =
  'focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0';

export const consoleIconButtonClass =
  'inline-flex items-center justify-center rounded-md p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 transition-colors duration-150 ease-in-out';

export const consoleIconButtonDangerClass =
  'inline-flex items-center justify-center rounded-md p-1.5 text-zinc-400 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 transition-colors duration-150 ease-in-out';
