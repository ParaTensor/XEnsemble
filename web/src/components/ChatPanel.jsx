import { useState, useRef, useEffect } from 'react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';

export default function ChatPanel({ sessionId, agentName, projectName, isProcessing, onSendMessage }) {
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: 'agent',
      content: `你好！我是 ${agentName || 'AI 助手'}。我可以帮你编写代码、调试问题、分析项目等。请告诉我你需要什么帮助。`,
    },
  ]);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (text) => {
    const userMsg = { id: Date.now(), role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);

    // TODO: Connect to actual WebSocket agent communication
    // For now, show a placeholder response
    setTimeout(() => {
      const agentMsg = {
        id: Date.now() + 1,
        role: 'agent',
        content: `收到您的请求："${text}"。正在处理中...`,
      };
      setMessages((prev) => [...prev, agentMsg]);
    }, 1000);
  };

  return (
    <div className="w-[42%] border-r border-zinc-800 flex flex-col bg-zinc-900/30 shrink-0">
      {/* Chat Header */}
      <div className="h-10 border-b border-zinc-800 bg-zinc-900/50 px-3 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-xs font-semibold text-zinc-100">
            {agentName || 'Agent'} 会话协同
          </span>
          {projectName && (
            <span className="text-[10px] text-purple-300 bg-purple-950/60 border border-purple-800/50 px-1.5 py-0.2 rounded font-mono">
              {projectName}
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4 text-xs">
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={isProcessing} />
    </div>
  );
}
