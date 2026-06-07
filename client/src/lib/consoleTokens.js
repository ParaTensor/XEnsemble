/** Console tokens — aligned with ParaRouter DESIGN.md */

export const consoleBackdropClass = 'fixed inset-0 bg-black/50';

export const consoleDialogPanelClass =
  'relative bg-white border border-zinc-200 shadow-sm rounded-lg text-left flex flex-col overflow-hidden';

/** Dialog width tiers — see docs/Designs.md § 弹窗 */
export const consoleDialogSmClass =
  `${consoleDialogPanelClass} w-full max-w-sm max-w-[calc(100vw-2rem)]`;

export const consoleDialogMdClass =
  `${consoleDialogPanelClass} w-[480px] max-w-[calc(100vw-2rem)]`;

export const consoleDialogLgClass =
  `${consoleDialogPanelClass} w-[560px] max-w-[calc(100vw-2rem)]`;

/** Admin agent form dialogs: height follows content, no inner scroll — see docs/Designs.md § Agents */
export const consoleDialogAdminFormPanelClass =
  'relative bg-white border border-zinc-200 shadow-sm rounded-lg text-left w-[480px] max-w-[calc(100vw-2rem)]';

export const consoleInputClass =
  'w-full bg-white border border-zinc-300 rounded-md px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-black focus:ring-1 focus:ring-black transition-colors';

export const consoleToolbarControlClass = 'h-9 min-h-9 text-sm';

export const consoleToolbarInputClass = `${consoleInputClass} ${consoleToolbarControlClass} py-1.5`;

export const consolePageStackClass = 'space-y-6';

/** Admin registry pages (Agents / Users): fill shell main, no page-level scrollbar */
export const consoleAdminPageClass = 'flex h-full min-h-0 w-full flex-col gap-6';

/** Console tool surface: workspace sidebar + terminal fill the shell main */
export const consoleToolPageClass = 'flex h-full min-h-0 w-full flex-col';

export const consoleAdminTableScrollClass = 'min-h-0 flex-1 overflow-auto console-scroll-hidden';

export const consoleTableShellClass =
  'bg-white border border-zinc-200 rounded-lg overflow-hidden shadow-sm';

export const consoleAdminTableShellClass =
  `${consoleTableShellClass} flex min-h-0 flex-1 flex-col`;

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

/** Settings 右侧面板：唯一滚动层，滚动条视觉隐藏 — see docs/Designs.md § Settings */
export const consoleSettingsPanelScrollClass =
  'flex-1 min-h-0 min-w-0 overflow-y-auto console-scroll-hidden bg-white px-5 py-4';

export const consoleSectionLabelClass =
  'text-xs font-semibold uppercase tracking-wider text-zinc-500';

/** Portal dropdowns — above dialog shell (z-101), below toast (z-200) */
export const consoleMenuDropdownZClass = 'z-[110]';

/** Icon-only actions — see docs/Designs.md § 图标按钮 */
export const consoleIconButtonClass =
  'inline-flex items-center justify-center rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1';

export const consoleIconButtonDangerClass =
  'inline-flex items-center justify-center rounded-md p-1.5 text-red-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1';
