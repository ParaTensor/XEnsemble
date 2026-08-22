import { cn } from '../lib/utils';
import { Bot, User } from 'lucide-react';

export default function ChatMessage({ message }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex items-start space-x-2.5', isUser && 'justify-end')}>
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
          AI
        </div>
      )}

      <div className={cn('max-w-[85%]', isUser && 'max-w-[85%]')}>
        <div className={cn(
          'p-3 rounded-xl text-xs leading-relaxed',
          isUser
            ? 'bg-zinc-800 text-zinc-100 rounded-tr-none border border-zinc-700 shadow-sm'
            : 'bg-zinc-900 text-zinc-300 rounded-tl-none border border-zinc-800 space-y-2',
        )}>
          <p>{message.content}</p>
          {message.metadata && (
            <div className="bg-zinc-950 p-2 rounded border border-zinc-800/80 font-mono text-[11px] text-zinc-400">
              {message.metadata}
            </div>
          )}
        </div>
      </div>

      {isUser && (
        <div className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
          U
        </div>
      )}
    </div>
  );
}
