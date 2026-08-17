/** Console tokens — aligned with ParaRouter DESIGN.md (Console surface). */

export const consoleBackdropClass = 'fixed inset-0 bg-black/50 transition-opacity';

export const consoleDialogPanelClass =
  'relative bg-white border border-zinc-200 shadow-sm rounded-lg text-left flex flex-col overflow-hidden';

/** Dialog width tiers — see docs/Designs.md § 弹窗 */
export const consoleDialogSmClass =
  `${consoleDialogPanelClass} w-full max-w-sm max-w-[calc(100vw-2rem)]`;

export const consoleDialogMdClass =
  `${consoleDialogPanelClass} w-[480px] max-w-[calc(100vw-2rem)]`;

export const consoleDialogLgClass =
  `${consoleDialogPanelClass} w-[560px] max-w-[calc(100vw-2rem)]`;

/** Structured form dialog (header / body / footer) — ParaRouter DESIGN.md § Modals */
export const consoleStructuredDialogPanelClass =
  `${consoleDialogMdClass} flex flex-col max-h-[90vh] overflow-hidden p-0`;

export const consoleStructuredDialogHeaderClass =
  'px-5 py-4 border-b border-zinc-200 shrink-0 bg-white';

export const consoleStructuredDialogBodyClass =
  'flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-4 console-scroll-hidden';

export const consoleStructuredDialogFooterClass =
  'border-t border-zinc-200 px-6 py-4 bg-zinc-50/80 flex justify-end gap-2 shrink-0';

/** Admin agent form dialogs: height follows content, no inner scroll — see docs/Designs.md § Agents */
export const consoleDialogAdminFormPanelClass =
  'relative bg-white border border-zinc-200 shadow-sm rounded-lg text-left w-[480px] max-w-[calc(100vw-2rem)]';

export const consoleInputClass =
  'w-full bg-white border border-zinc-300 rounded-md px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-black focus:ring-1 focus:ring-black transition-colors';

export const consoleToolbarControlClass = 'h-9 min-h-9 text-sm';

export const consoleToolbarInputClass = `${consoleInputClass} ${consoleToolbarControlClass} py-1.5`;

export const consolePageStackClass = 'space-y-6';

export const consolePageTitleClass = 'text-2xl font-bold tracking-tight text-zinc-900';

/** Admin registry pages (Agents / Users): fill shell main, no page-level scrollbar */
export const consoleAdminPageClass = 'flex h-full min-h-0 w-full flex-col gap-6';

/** Console tool surface: workspace sidebar + terminal fill the shell main */
export const consoleToolPageClass = 'flex h-full min-h-0 w-full flex-col';

export const consoleAdminTableScrollClass = 'min-h-0 flex-1 overflow-auto console-scroll-hidden';

export const consoleTableShellClass =
  'bg-white border border-zinc-200 rounded-lg overflow-hidden shadow-sm';

export const consoleAdminTableShellClass =
  `${consoleTableShellClass} flex min-h-0 flex-1 flex-col`;

export const consoleTableHeadRowClass = 'bg-zinc-50 border-b border-zinc-200';

export const consoleTableBodyDivideClass = 'divide-y divide-zinc-200';

export const consoleTableBodyRowClass = 'hover:bg-zinc-50/50 transition-colors';

export const consoleTableHeadCellClass =
  'px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider';

export const consoleTableBodyCellClass = 'px-4 py-3 text-sm text-zinc-700';

export const consoleTableHeadCellDenseClass =
  'px-3 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider';

export const consoleTableBodyCellDenseClass = 'px-3 py-3 text-sm text-zinc-700';

export const consoleTableSectionHeaderClass =
  'px-4 py-3 border-b border-zinc-200 flex items-center justify-between';

export const consoleCardClass = 'bg-white border border-zinc-200 rounded-lg shadow-sm';

export const consoleFormLabelClass =
  'block text-xs font-semibold uppercase tracking-wider text-zinc-500';

/** Alias kept for existing call sites */
export const consoleSectionLabelClass = consoleFormLabelClass;

export const consoleDropdownPanelClass =
  'rounded-lg border border-zinc-200 bg-white shadow-sm';

export const consoleFilterToolbarClass =
  'bg-white border border-zinc-200 rounded-lg p-4 sm:p-5 shadow-sm space-y-4';

export const consoleStatValueClass = 'text-2xl font-bold tracking-tight text-zinc-900';

export const consoleEmptyStateClass =
  'flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-200 bg-zinc-50/50';

export const consoleNavActiveClass = 'bg-zinc-100 text-zinc-900';

export const consoleNavIdleClass = 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900';

export const consoleSettingsTabActiveClass =
  'bg-black text-white shadow-lg shadow-black/10';

export const consoleSettingsTabIdleClass =
  'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900';

/** Settings 右侧面板：唯一滚动层，滚动条视觉隐藏 — see docs/Designs.md § Settings */
export const consoleSettingsPanelScrollClass =
  'flex-1 min-h-0 min-w-0 overflow-y-auto console-scroll-hidden bg-white px-5 py-4';

/** Status badge — content-sized; the icon slot (consoleStatusIconSlotClass) stays fixed to prevent column shift when spinner appears (DESIGN.md § 页面稳定性) */
export const consoleStatusBadgeClass =
  'inline-flex items-center gap-1 text-xs whitespace-nowrap';

export const consoleStatusIconSlotClass =
  'inline-flex w-3 h-3 shrink-0 items-center justify-center';

/** Portal dropdowns — above dialog shell (z-101), below toast (z-200) */
export const consoleMenuDropdownZClass = 'z-[110]';

/** Icon-only actions — see docs/Designs.md § 图标按钮 */
export const consoleButtonFocusClass =
  'focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0';

export const consoleIconButtonClass =
  `inline-flex items-center justify-center rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 disabled:pointer-events-none ${consoleButtonFocusClass}`;

export const consoleIconButtonDangerClass =
  `inline-flex items-center justify-center rounded-md p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-40 disabled:pointer-events-none ${consoleButtonFocusClass}`;
