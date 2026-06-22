'use client';

import { useState, useEffect, useRef } from 'react';
import { fetchStrategies, sendChatMessage, getChatStatus } from '../../lib/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Strategy {
  id: string;
  name: string;
  symbol: string;
  exchange: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getChatStatus().then((s) => setConfigured(s.configured)).catch(() => setConfigured(false));
    fetchStrategies().then(setStrategies).catch(() => {});
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, loading]);

  const handleSend = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    const userMsg: ChatMessage = { role: 'user', content };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setLoading(true);

    try {
      const { response } = await sendChatMessage(
        content,
        updated.slice(-20),
        selectedStrategy || undefined,
      );
      setMessages([...updated, { role: 'assistant', content: response }]);
    } catch {
      setMessages([...updated, { role: 'assistant', content: 'Erro ao conectar com a IA. Verifique se ANTHROPIC_API_KEY est\u00e1 configurada.' }]);
    }
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (configured === false) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="bg-slate-800 rounded-lg border border-slate-700 p-8 max-w-md text-center">
          <div className="text-4xl mb-4">&#x1f916;</div>
          <h2 className="text-xl font-bold mb-2">AI Chat Not Configured</h2>
          <p className="text-slate-400 text-sm mb-4">
            Add <code className="bg-slate-700 px-1.5 py-0.5 rounded text-emerald-400">ANTHROPIC_API_KEY</code> to your environment variables on Railway to enable AI chat.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">AI Chat</h1>
        <div className="flex items-center gap-3">
          <select
            value={selectedStrategy}
            onChange={(e) => setSelectedStrategy(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
          >
            <option value="">No strategy context</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.symbol} ({s.exchange})
              </option>
            ))}
          </select>
          <button
            onClick={() => setMessages([])}
            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm transition"
          >
            Clear Chat
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto bg-slate-800 rounded-lg border border-slate-700 p-4 space-y-4 mb-4">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-4">
            <div className="text-5xl">&#x2728;</div>
            <div className="text-center">
              <h2 className="text-lg font-semibold text-slate-300 mb-1">Singularity AI</h2>
              <p className="text-sm max-w-md">
                Analiso seus trades, explico diverg&ecirc;ncias do auditor, sugiro ajustes de par&acirc;metros e ajudo com estrat&eacute;gias.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-md">
              {[
                'Quais foram os principais problemas detectados pelo auditor?',
                'Compare o desempenho do backtest vs trades reais',
                'Sugira ajustes para reduzir slippage',
              ].map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(suggestion)}
                  className="text-left px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-sm hover:border-blue-500/50 hover:bg-slate-700 transition"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'bg-blue-600/20 border border-blue-500/30'
                : 'bg-slate-700/50 border border-slate-600'
            }`}>
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span className="animate-pulse">&#9679;</span> Thinking...
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your trades, audit results, or strategies..."
          className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-sm resize-none focus:outline-none focus:border-blue-500 transition"
          rows={2}
          disabled={loading}
        />
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || loading}
          className="px-6 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg text-sm font-medium transition self-end py-3"
        >
          Send
        </button>
      </div>
    </div>
  );
}
