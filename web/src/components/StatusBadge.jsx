import { Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  consoleStatusBadgeClass,
  consoleStatusIconSlotClass,
} from '../lib/consoleTheme';

export const STATUS_TONES = {
  success: 'bg-emerald-950 text-emerald-300 border border-emerald-800/60',
  warning: 'bg-amber-950 text-amber-300 border border-amber-800/60',
  danger: 'bg-red-500/10 text-red-300 border border-red-500/30',
  info: 'bg-blue-500/10 text-blue-300 border border-blue-500/30',
  neutral: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
};

export default function StatusBadge({ tone = 'neutral', icon: Icon, spinning = false, label, title, className }) {
  return (
    <span
      title={title}
      className={cn(
        consoleStatusBadgeClass,
        'rounded border px-1.5 py-0.5',
        STATUS_TONES[tone] || STATUS_TONES.neutral,
        className,
      )}
    >
      <span className={consoleStatusIconSlotClass} aria-hidden>
        {spinning ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : Icon ? (
          <Icon className="h-3 w-3" />
        ) : null}
      </span>
      <span>{label}</span>
    </span>
  );
}
