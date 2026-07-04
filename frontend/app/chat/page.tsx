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
        <div className="glass-card rounded-lg p-8 max-w-md text-center">
          <div className="w-12 h-12 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
          </div>
          <h2 className="text-base font-bold text-foreground mb-2">AI Chat Não Configurado</h2>
          <p className="text-muted-foreground text-xs mb-4">
            Adicione <code className="bg-secondary px-1.5 py-0.5 rounded text-accent text-[10px] font-mono">ANTHROPIC_API_KEY</code> nas variáveis de ambiente do Railway para habilitar o AI Chat.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">AI Chat</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Analise trades e estratégias com IA</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedStrategy}
            onChange={(e) => setSelectedStrategy(e.target.value)}
            className="bg-secondary/80 border border-border/60 rounded-md px-3 py-2 text-xs text-foreground focus:border-primary/50 outline-none transition"
          >
            <option value="">Sem contexto de estratégia</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.symbol} ({s.exchange})
              </option>
            ))}
          </select>
          <button
            onClick={() => setMessages([])}
            className="px-3 py-2 bg-secondary/80 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/40 rounded-md text-xs transition"
          >
            Limpar
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto glass-card rounded-lg p-4 space-y-3 mb-3 scrollbar-thin">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
            <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary">
                <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <div className="text-center">
              <h2 className="text-sm font-semibold text-foreground mb-1">Singularity AI</h2>
              <p className="text-xs max-w-md text-muted-foreground">
                Analiso seus trades, explico divergências do auditor, sugiro ajustes de parâmetros e ajudo com estratégias.
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
                  className="text-left px-4 py-3 bg-secondary/40 border border-border/40 rounded-lg text-xs hover:border-primary/30 hover:bg-secondary/60 transition text-foreground/80"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-3 text-xs leading-relaxed ${
              msg.role === 'user'
                ? 'bg-primary/15 border border-primary/20 text-foreground'
                : 'bg-secondary/40 border border-border/40 text-foreground/90'
            }`}>
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            Pensando...
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pergunte sobre seus trades, resultados do auditor, ou estratégias..."
          className="flex-1 bg-secondary/80 border border-border/60 rounded-lg px-4 py-3 text-xs resize-none focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition text-foreground placeholder:text-muted-foreground/50"
          rows={2}
          disabled={loading}
        />
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || loading}
          className="px-5 bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 disabled:bg-secondary disabled:text-muted-foreground disabled:border-border/40 rounded-lg text-xs font-medium transition self-end py-3"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
