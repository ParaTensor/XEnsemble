import { cn } from './utils';

export const buttonBase =
  'inline-flex items-center justify-center gap-2 font-medium transition-colors focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 disabled:opacity-50 disabled:pointer-events-none';

export const buttonSizes = {
  sm: 'h-9 px-3 text-sm rounded-md',
  md: 'h-9 px-4 text-sm rounded-md',
  lg: 'px-8 py-3 text-base rounded-md',
};

export const buttonVariants = {
  primary: 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm',
  secondary:
    'bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700',
  ghost: 'p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

export function buttonClass(variant = 'primary', size = 'md', className) {
  if (variant === 'ghost') {
    return cn(buttonBase, buttonVariants.ghost, className);
  }
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}
