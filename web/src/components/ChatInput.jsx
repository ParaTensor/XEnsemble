import { useState } from 'react';
import { Send } from 'lucide-react';

export default function ChatInput({ onSend, disabled }) {
  const [value, setValue] = useState('');

  const handleSubmit = () => {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="p-3 border-t border-zinc-800 bg-zinc-900/80">
      <div className="relative flex items-center">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入需求或指令，按 Enter 键发送给 Agent..."
          disabled={disabled}
          className="w-full bg-zinc-950 text-xs text-zinc-100 placeholder-zinc-500 rounded-lg px-3.5 py-2.5 pr-20 border border-zinc-700 focus:outline-none focus:border-emerald-500 transition disabled:opacity-50"
        />
        <div className="absolute right-2 flex items-center space-x-1">
          <button
            onClick={handleSubmit}
            disabled={disabled || !value.trim()}
            className="p-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
